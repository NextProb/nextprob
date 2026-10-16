const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");

const execFileAsync = promisify(execFile);

// ─── State Machine ────────────────────────────────────────────────────────────

const TRANSITIONS = {
  'not-configured': new Set(['idle']),
  'idle':           new Set(['syncing', 'not-configured']),
  'syncing':        new Set(['idle', 'conflict', 'error']),
  'conflict':       new Set(['idle', 'error']),
  'error':          new Set(['idle', 'syncing', 'not-configured']),
};

let _state = null; // null until initSyncState() is called

// ─── Event Emitter ────────────────────────────────────────────────────────────

let _listeners = [];

function _notify(previousState, error) {
  const event = { state: _state, previousState, timestamp: Date.now(), paused: _userPaused };
  if (error) event.error = error;
  for (const cb of _listeners) cb(event);
}

function onStatusChange(callback) {
  _listeners.push(callback);
  return () => offStatusChange(callback);
}

function offStatusChange(callback) {
  _listeners = _listeners.filter(l => l !== callback);
}

// ─── Internal Transition ──────────────────────────────────────────────────────

function transition(nextState, error) {
  const valid = TRANSITIONS[_state];
  if (!valid || !valid.has(nextState)) {
    throw new Error(`sync: invalid transition from '${_state}' to '${nextState}'`);
  }
  const prev = _state;
  _state = nextState;
  if (prev === 'conflict') clearConflicts();
  _notify(prev, error);
}

function getState() {
  return _state;
}

// initSyncState accepts the already-fetched gitStatus object (avoids redundant getGitStatus call).
// Bypasses the transition map intentionally — this is an initialization/reset, not a runtime op.
function initSyncState(gitStatus) {
  const nextState = (gitStatus.isRepo && gitStatus.hasRemote) ? 'idle' : 'not-configured';
  const prev = _state;
  _state = nextState;
  _notify(prev);
}

// ─── Conflict Store (feature 72) ──────────────────────────────────────────────

let _conflicts = [];

function getConflicts() {
  return _conflicts.slice();
}

function clearConflicts() {
  _conflicts = [];
}

// ─── Conflict Resolution (feature 73) ────────────────────────────────────────

async function resolveConflict(filePath, chosenContent) {
  const idx = _conflicts.findIndex(c => c.filePath === filePath);
  if (idx === -1) return { ok: false, error: 'conflict not found' };
  if (!_pushPullWorkspacePath) return { ok: false, error: 'engine not started' };

  const fullPath = path.join(_pushPullWorkspacePath, filePath);
  await fs.promises.writeFile(fullPath, chosenContent, 'utf8');

  await enqueue(async () => {
    const bin = findGitBin();
    await execFileAsync(bin, ['add', filePath], {
      cwd: _pushPullWorkspacePath,
      timeout: PUSH_PULL_TIMEOUT_MS,
    });
  });

  _conflicts.splice(idx, 1);
  _logActivity('conflict', 'success', 'Resolved conflict: ' + filePath);
  return { ok: true, remaining: _conflicts.length };
}

async function finalizeMerge() {
  if (!_pushPullActive || !_pushPullWorkspacePath) {
    return { ok: false, error: 'engine not started' };
  }

  await enqueue(async () => {
    const bin = findGitBin();
    await execFileAsync(bin, ['commit', '--no-edit'], {
      cwd: _pushPullWorkspacePath,
      timeout: PUSH_PULL_TIMEOUT_MS,
    });
  });

  _logActivity('conflict', 'success', 'Merge committed');
  transition('idle'); // clears _conflicts, notifies listeners with previousState='conflict'
  return _executePushWithRetry();
}

async function abortMerge() {
  if (!_pushPullActive || !_pushPullWorkspacePath) {
    return { ok: false, error: 'engine not started' };
  }

  await enqueue(async () => {
    const bin = findGitBin();
    await execFileAsync(bin, ['merge', '--abort'], {
      cwd: _pushPullWorkspacePath,
      timeout: PUSH_PULL_TIMEOUT_MS,
    });
  });

  _logActivity('conflict', 'success', 'Merge aborted');
  transition('idle'); // auto-calls clearConflicts()
  return { ok: true };
}

// ─── Activity Log (feature 74) ───────────────────────────────────────────────

const LOG_MAX = 50;
let _activityLog = [];

function _logActivity(action, result, details) {
  _activityLog.push({ timestamp: Date.now(), action, result, details });
  if (_activityLog.length > LOG_MAX) _activityLog.shift();
}

function getActivityLog() {
  return _activityLog.slice(); // shallow copy; renderer reverses for display
}

function clearActivityLog() {
  _activityLog = [];
}

// ─── Pause Persistence (feature 77) ──────────────────────────────────────────

async function readSyncPaused(workspacePath) {
  const bin = findGitBin();
  try {
    const { stdout } = await execFileAsync(
      bin,
      ['config', '--local', '--get', 'notesapp.syncPaused'],
      { cwd: workspacePath }
    );
    return stdout.trim() === 'true';
  } catch {
    return false; // key not set (exit code 1) or git not available
  }
}

async function writeSyncPaused(workspacePath, paused) {
  const bin = findGitBin();
  await execFileAsync(
    bin,
    ['config', '--local', 'notesapp.syncPaused', paused ? 'true' : 'false'],
    { cwd: workspacePath }
  );
}

// ─── Sync User Settings (feature 78) ─────────────────────────────────────────

const SYNC_SETTINGS_DEFAULTS = {
  commitDebounceSeconds: 30,
  pushIntervalSeconds: 300,
  syncOnFocus: true,
  pauseDuringClaude: true,
};

async function readSyncSetting(workspacePath, key) {
  const bin = findGitBin();
  try {
    const { stdout } = await execFileAsync(
      bin,
      ['config', '--local', '--get', `notesapp.${key}`],
      { cwd: workspacePath }
    );
    return stdout.trim();
  } catch {
    return null; // key not set (exit code 1) or git unavailable
  }
}

async function writeSyncSetting(workspacePath, key, value) {
  const bin = findGitBin();
  await execFileAsync(
    bin,
    ['config', '--local', `notesapp.${key}`, String(value)],
    { cwd: workspacePath }
  );
}

function _parseIntSetting(val, defaultValue, min, max) {
  if (val === null) return defaultValue;
  const n = parseInt(val, 10);
  if (isNaN(n)) return defaultValue;
  return Math.min(max, Math.max(min, n));
}

function _parseBoolSetting(val, defaultValue) {
  if (val === null) return defaultValue;
  if (val.trim() === 'true') return true;
  if (val.trim() === 'false') return false;
  return defaultValue;
}

async function readAllSyncSettings(workspacePath) {
  const [debounce, pushInterval, syncOnFocus, pauseDuringClaude] = await Promise.all([
    readSyncSetting(workspacePath, 'commitDebounceSeconds'),
    readSyncSetting(workspacePath, 'pushIntervalSeconds'),
    readSyncSetting(workspacePath, 'syncOnFocus'),
    readSyncSetting(workspacePath, 'pauseDuringClaude'),
  ]);
  return {
    commitDebounceSeconds: _parseIntSetting(debounce, 30, 10, 300),
    pushIntervalSeconds:   _parseIntSetting(pushInterval, 300, 60, 1800),
    syncOnFocus:           _parseBoolSetting(syncOnFocus, true),
    pauseDuringClaude:     _parseBoolSetting(pauseDuringClaude, true),
  };
}

async function writeSyncSettings(workspacePath, settings) {
  for (const [key, value] of Object.entries(settings)) {
    await writeSyncSetting(workspacePath, key, value);
  }
  applySyncSettings(settings);
}

function applySyncSettings(settings) {
  COMMIT_DEBOUNCE_MS = settings.commitDebounceSeconds * 1000;
  PERIODIC_SYNC_INTERVAL_MS = settings.pushIntervalSeconds * 1000;
  _syncOnFocusEnabled = settings.syncOnFocus;
  _pauseDuringClaudeEnabled = settings.pauseDuringClaude;
  // Restart the periodic timer if running so the new interval takes effect immediately
  _resetPeriodicTimer();
}

async function pauseSync(workspacePath) {
  _userPaused = true;
  _pauseAutoSync();
  clearTimeout(_commitDebounceTimer);
  _commitDebounceTimer = null;
  await writeSyncPaused(workspacePath, true);
  _logActivity('pause', 'success', 'Sync paused by user');
  _notify(null);  // no state change, just notify to update paused flag
}

async function resumeSync(workspacePath) {
  _userPaused = false;
  await writeSyncPaused(workspacePath, false);
  _resumeAutoSync();
  _logActivity('resume', 'success', 'Sync resumed by user');
  _notify(null);
  _triggerPostCommitSync();
}

function isSyncPaused() {
  return _userPaused;
}

async function disconnectSync(workspacePath) {
  stopAutoSync();
  stopPushPullEngine();
  stopCommitEngine();
  const bin = findGitBin();
  try {
    await execFileAsync(bin, ['remote', 'remove', 'origin'], { cwd: workspacePath });
  } catch (err) {
    process.stderr.write(`sync disconnect: git remote remove failed: ${err.message}\n`);
  }
  _userPaused = false;
  try {
    await execFileAsync(
      bin,
      ['config', '--local', '--unset', 'notesapp.syncPaused'],
      { cwd: workspacePath }
    );
  } catch { /* key may not be set — ignore */ }
  _logActivity('disconnect', 'success', 'Sync disconnected — remote removed');
  const prev = _state;
  _state = 'not-configured';
  _notify(prev);
}

// ─── Corrupted State Recovery (feature 75) ───────────────────────────────────

async function checkRepoHealth(workspacePath) {
  const bin = findGitBin();
  const gitDir = path.join(workspacePath, '.git');
  const issues = [];

  // 1. Locked index
  if (fs.existsSync(path.join(gitDir, 'index.lock'))) {
    issues.push({
      type: 'locked-index',
      description: 'A previous git operation was interrupted, leaving a lock file that prevents further operations. Removing it will allow sync to resume.',
      recoveryAction: 'recoverLockedIndex',
    });
  }

  // 2. Interrupted rebase
  if (fs.existsSync(path.join(gitDir, 'rebase-merge')) ||
      fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
    issues.push({
      type: 'interrupted-rebase',
      description: 'A rebase operation was interrupted before it could complete. Aborting it will return your repository to its previous state.',
      recoveryAction: 'recoverInterruptedRebase',
    });
  }

  // 3. Interrupted merge
  if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) {
    issues.push({
      type: 'interrupted-merge',
      description: 'A merge operation was interrupted before it could complete. Aborting it will return your repository to its previous state.',
      recoveryAction: 'recoverInterruptedMerge',
    });
  }

  // 4. Detached HEAD
  try {
    const { stdout } = await execFileAsync(bin, ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspacePath,
      timeout: 5000,
    });
    if (stdout.trim() === 'HEAD') {
      issues.push({
        type: 'detached-head',
        description: 'Your repository is not on any branch. This can happen after checking out a specific commit. Select a branch to return to.',
        recoveryAction: 'recoverDetachedHead',
      });
    }
  } catch {
    // Can't determine HEAD state — not a corruption we handle
  }

  return { healthy: issues.length === 0, issues };
}

async function recoverLockedIndex(workspacePath) {
  return enqueue(async () => {
    try {
      await fs.promises.unlink(path.join(workspacePath, '.git', 'index.lock'));
      _logActivity('recovery', 'success', 'Removed stale index.lock');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

async function recoverInterruptedRebase(workspacePath) {
  return enqueue(async () => {
    const bin = findGitBin();
    try {
      await execFileAsync(bin, ['rebase', '--abort'], { cwd: workspacePath, timeout: 15000 });
    } catch {
      // Abort may fail if the state files are malformed; try manual cleanup below
    }
    // Manual cleanup in case abort didn't fully clean up
    const gitDir = path.join(workspacePath, '.git');
    for (const dir of ['rebase-merge', 'rebase-apply']) {
      const p = path.join(gitDir, dir);
      if (fs.existsSync(p)) {
        await fs.promises.rm(p, { recursive: true, force: true });
      }
    }
    _logActivity('recovery', 'success', 'Aborted interrupted rebase');
    return { ok: true };
  });
}

async function recoverInterruptedMerge(workspacePath) {
  return enqueue(async () => {
    const bin = findGitBin();
    try {
      await execFileAsync(bin, ['merge', '--abort'], { cwd: workspacePath, timeout: 15000 });
      _logActivity('recovery', 'success', 'Aborted interrupted merge');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.stderr || err.message };
    }
  });
}

async function recoverDetachedHead(workspacePath, targetBranch) {
  return enqueue(async () => {
    const bin = findGitBin();
    try {
      await execFileAsync(bin, ['checkout', targetBranch], { cwd: workspacePath, timeout: 15000 });
      _logActivity('recovery', 'success', 'Checked out branch: ' + targetBranch);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.stderr || err.message };
    }
  });
}

async function _copyDirRecursive(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue; // skip .git
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await _copyDirRecursive(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

async function recoverReclone(workspacePath, remoteUrl) {
  // 1. Stop engines
  stopAutoSync();
  stopCommitEngine();
  stopPushPullEngine();

  const workspaceBase = path.basename(workspacePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(path.dirname(workspacePath), `${workspaceBase}-backup-${timestamp}`);
  const tmpDir = path.join(os.tmpdir(), `notes-reclone-${Date.now()}`);

  // 2. Backup non-.git files
  try {
    await _copyDirRecursive(workspacePath, backupPath);
  } catch (err) {
    return { ok: false, error: 'Backup failed: ' + err.message };
  }

  // 3. Remove .git directory
  try {
    await fs.promises.rm(path.join(workspacePath, '.git'), { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: 'Failed to remove .git: ' + err.message };
  }

  // 4. Clone into temp dir
  const bin = findGitBin();
  try {
    await execFileAsync(bin, ['clone', '--depth', '1', remoteUrl, tmpDir], { timeout: 60000 });
  } catch (err) {
    return { ok: false, error: 'Clone failed: ' + (err.stderr || err.message) };
  }

  // 5. Move .git from temp clone into workspace
  try {
    await fs.promises.rename(path.join(tmpDir, '.git'), path.join(workspacePath, '.git'));
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: 'Failed to move .git: ' + err.message };
  }

  _logActivity('recovery', 'success', 'Re-cloned from remote. Backup at: ' + backupPath);
  return { ok: true, backupPath };
}

async function listBranches(workspacePath) {
  const bin = findGitBin();
  try {
    const { stdout } = await execFileAsync(bin, ['branch', '--list', '--format=%(refname:short)'], {
      cwd: workspacePath,
      timeout: 5000,
    });
    return stdout.split('\n').map(b => b.trim()).filter(b => b.length > 0);
  } catch {
    return [];
  }
}

// ─── Second Device Clone (feature 76) ────────────────────────────────────────

async function cloneRepo(remoteUrl, targetPath) {
  const bin = findGitBin();
  try {
    await execFileAsync(bin, ['clone', '--depth', '1', remoteUrl, targetPath], {
      timeout: 120000,
    });
    return { ok: true, path: targetPath };
  } catch (err) {
    const errorType = classifyError(err.stderr, err.code, err.stdout);
    return { ok: false, error: err.stderr || err.message, errorType };
  }
}

function checkTargetDirectory(targetPath) {
  try {
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      return { exists: true, isEmpty: false, hasGit: false, entries: 0, notADir: true };
    }
    const entries = fs.readdirSync(targetPath);
    const hasGit = entries.includes('.git');
    return { exists: true, isEmpty: entries.length === 0, hasGit, entries: entries.length };
  } catch {
    // Path does not exist
    return { exists: false, isEmpty: true, hasGit: false, entries: 0 };
  }
}

// ─── Error Classifier ─────────────────────────────────────────────────────────

function classifyError(stderr, exitCode, stdout) {
  const s = (stderr || '').toLowerCase();
  if (s.includes('could not resolve host') || s.includes('connection refused') ||
      s.includes('timed out') || s.includes('timeout') ||
      s.includes("couldn't connect") || s.includes('failed to connect') ||
      s.includes('no route to host') || s.includes('network is unreachable')) {
    return 'network';
  }
  if (s.includes('authentication failed') || s.includes('permission denied') ||
      (exitCode === 128 && s.includes('could not read'))) {
    return 'auth';
  }
  if (s.includes('conflict') || (stdout || '').toLowerCase().includes('conflict')) {
    return 'conflict';
  }
  if (s.includes('corrupt') || s.includes('broken') || s.includes('index.lock')) {
    return 'corruption';
  }
  return 'unknown';
}

// ─── Operation Queue (Promise-chain Mutex) ────────────────────────────────────

let _queue = Promise.resolve();
let _busy = false;
let _shuttingDown = false;

function enqueue(operationFn) {
  if (_shuttingDown) {
    return Promise.reject(new Error('sync: shutting down'));
  }

  const resultPromise = new Promise((resolve, reject) => {
    _queue = _queue.then(async () => {
      if (_shuttingDown) {
        reject(new Error('sync: shutting down'));
        return;
      }
      _busy = true;
      try {
        const result = await operationFn();
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        _busy = false;
      }
    }).catch(() => {}); // prevent unhandled rejection on the chain itself
  });

  return resultPromise;
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

function shutdown() {
  stopAutoSync();
  stopCommitEngine();
  stopPushPullEngine();
  _shuttingDown = true;
  if (!_busy) {
    if (_state === 'syncing') {
      _state = 'idle';
    }
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, 5000);
    _queue.then(() => {
      clearTimeout(timeoutId);
      resolve();
    }).catch(() => {
      clearTimeout(timeoutId);
      resolve();
    });
  });
}

// Cache the git binary path on first resolution (mirrors findClaudeBin() in bridge.js)
let gitBin = null;

function findGitBin() {
  if (gitBin !== null) return gitBin;
  const candidates = [
    "/usr/bin/git",                               // macOS with Xcode CLT
    "/usr/local/bin/git",                         // Homebrew (Intel Mac)
    "/opt/homebrew/bin/git",                      // Homebrew (Apple Silicon)
    path.join(os.homedir(), ".local", "bin", "git"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      gitBin = p;
      return gitBin;
    }
  }
  gitBin = "git"; // fall back to PATH
  return gitBin;
}

async function getGitStatus(workspacePath) {
  const bin = findGitBin();

  // 1. Check git is installed
  try {
    await execFileAsync(bin, ["--version"]);
  } catch {
    return { gitInstalled: false, isRepo: false, hasRemote: false, remoteUrl: null, branch: null };
  }

  // 2. Check if workspace is a git repo
  try {
    await execFileAsync(bin, ["rev-parse", "--git-dir"], { cwd: workspacePath });
  } catch {
    return { gitInstalled: true, isRepo: false, hasRemote: false, remoteUrl: null, branch: null };
  }

  // 3. Detect current branch (independent of remote)
  let branch = null;
  try {
    const result = await execFileAsync(bin, ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: workspacePath });
    branch = result.stdout.trim() || null;
  } catch {
    // New repo with no commits: HEAD doesn't resolve; branch stays null
  }

  // 4. Detect origin remote URL
  let hasRemote = false;
  let remoteUrl = null;
  try {
    const result = await execFileAsync(bin, ["remote", "get-url", "origin"], { cwd: workspacePath });
    remoteUrl = result.stdout.trim() || null;
    hasRemote = remoteUrl !== null;
  } catch {
    // No remote named "origin"
  }

  return { gitInstalled: true, isRepo: true, hasRemote, remoteUrl, branch };
}

// ─── Auth Check ───────────────────────────────────────────────────────────────

function detectAuthMethod(remoteUrl) {
  if (!remoteUrl) return 'unknown';
  if (remoteUrl.startsWith('https://') || remoteUrl.startsWith('http://')) return 'https';
  if (remoteUrl.startsWith('git@') || remoteUrl.startsWith('ssh://')) return 'ssh';
  return 'unknown';
}

let _authCache = { url: null, ok: null, timestamp: null };
const AUTH_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function clearAuthCache() {
  _authCache = { url: null, ok: null, timestamp: null };
}

function probeHost(remoteUrl, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(remoteUrl);
    } catch {
      resolve(false);
      return;
    }
    const port = parsed.port
      ? Number(parsed.port)
      : (parsed.protocol === 'https:' ? 443 : 80);
    const socket = net.connect({ host: parsed.hostname, port, timeout: timeoutMs });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error',   () => { socket.destroy(); resolve(false); });
  });
}

async function diagnoseAuthFailure(method, stderr, exitCode, remoteUrl) {
  let errorType = classifyError(stderr, exitCode);

  // Disambiguate: "could not read Username" fires for both auth and network failures.
  // If the host is unreachable, reclassify as network.
  if (errorType === 'auth' && (stderr || '').toLowerCase().includes('could not read') && remoteUrl) {
    const reachable = await probeHost(remoteUrl);
    if (!reachable) {
      errorType = 'network';
    }
  }

  if (errorType === 'network') {
    return {
      errorType: 'network',
      guidance: {
        title: 'Cannot reach remote',
        message: 'Check your internet connection and verify the remote URL is correct.',
        steps: [
          'Check your internet connection',
          `Verify the remote URL: ${remoteUrl || '(unknown)'}`,
          'If using a VPN or proxy, ensure git traffic is allowed',
        ],
      },
    };
  }

  if (method === 'https' && errorType === 'auth') {
    let ghAvailable = false;
    try {
      await execFileAsync('gh', ['--version']);
      ghAvailable = true;
    } catch {
      ghAvailable = false;
    }
    if (ghAvailable) {
      return {
        errorType: 'auth',
        guidance: {
          title: 'GitHub authentication required',
          message: 'Run `gh auth login` in your terminal to authenticate with GitHub.',
          steps: [
            'Open a terminal',
            'Run: gh auth login',
            'Follow the prompts, then retry',
          ],
        },
      };
    } else {
      return {
        errorType: 'auth',
        guidance: {
          title: 'Git credentials not configured',
          message: 'Set up a personal access token or install the GitHub CLI.',
          steps: [
            'Go to GitHub → Settings → Developer settings → Personal access tokens',
            "Generate a new token with 'repo' scope",
            'Use the token as your password when prompted, or run: git config --global credential.helper store',
          ],
        },
      };
    }
  }

  if (method === 'ssh' && errorType === 'auth') {
    const home = os.homedir();
    const keyFiles = ['id_ed25519', 'id_rsa', 'id_ecdsa'];
    const hasKey = keyFiles.some(f => fs.existsSync(path.join(home, '.ssh', f)));
    if (!hasKey) {
      return {
        errorType: 'auth',
        guidance: {
          title: 'No SSH key found',
          message: 'Generate an SSH key and add it to your GitHub account.',
          steps: [
            'Open a terminal',
            'Run: ssh-keygen -t ed25519 -C "your-email@example.com"',
            'Copy the public key: cat ~/.ssh/id_ed25519.pub',
            'Go to GitHub → Settings → SSH keys → New SSH key',
            'Paste the key and save, then retry',
          ],
        },
      };
    } else {
      return {
        errorType: 'auth',
        guidance: {
          title: 'SSH key not authorized',
          message: "Your SSH key exists but GitHub doesn't recognize it.",
          steps: [
            'Copy your public key: cat ~/.ssh/id_ed25519.pub',
            'Go to GitHub → Settings → SSH keys → New SSH key',
            'Paste the key and save, then retry',
            'If already added, check that the key is not expired or revoked',
          ],
        },
      };
    }
  }

  // Unknown method or unclassifiable error
  return {
    errorType: errorType || 'unknown',
    guidance: {
      title: 'Authentication failed',
      message: 'Could not connect to the remote repository.',
      steps: [
        'Verify the remote URL is correct',
        'Check that you have access to the repository',
      ],
    },
  };
}

async function checkAuth(workspacePath, remoteUrl) {
  const method = detectAuthMethod(remoteUrl);

  // Cache hit: return early for a recent successful check on the same URL
  if (
    _authCache.url === remoteUrl &&
    _authCache.ok === true &&
    _authCache.timestamp !== null &&
    Date.now() - _authCache.timestamp < AUTH_CACHE_TTL_MS
  ) {
    return { ok: true, method, cached: true };
  }

  const bin = findGitBin();
  try {
    await execFileAsync(bin, ['ls-remote', remoteUrl], {
      cwd: workspacePath,
      timeout: 10000,
    });
    _authCache = { url: remoteUrl, ok: true, timestamp: Date.now() };
    return { ok: true, method, cached: false };
  } catch (err) {
    // Invalidate cache on any failure
    _authCache = { url: null, ok: null, timestamp: null };
    const stderr = err.stderr || '';
    // If the process was killed by timeout, synthesize a recognisable stderr string
    const effectiveStderr = err.killed ? 'timed out' : stderr;
    const exitCode = err.code || null;
    _logActivity('auth-fail', 'failure', 'Authentication failed');
    const diagnosis = await diagnoseAuthFailure(method, effectiveStderr, exitCode, remoteUrl);
    return { ok: false, method, ...diagnosis };
  }
}

// ─── Gitignore Management ─────────────────────────────────────────────────────

const GITIGNORE_HEADER = '# notes-app sync defaults';
const DEFAULT_GITIGNORE_ENTRIES = [
  'node_modules/',
  '.claude-temp/',
  '.DS_Store',
  '*.tmp',
  '.Trash/',
  '*/storage/',
  '.syncignore',
];

async function ensureGitignore(workspacePath) {
  const gitignorePath = path.join(workspacePath, '.gitignore');

  let exists = false;
  let content = '';
  try {
    content = await fs.promises.readFile(gitignorePath, 'utf8');
    exists = true;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  if (!exists) {
    const fileContent = GITIGNORE_HEADER + '\n' + DEFAULT_GITIGNORE_ENTRIES.join('\n') + '\n';
    await fs.promises.writeFile(gitignorePath, fileContent, 'utf8');
    return { created: true, entriesAdded: [...DEFAULT_GITIGNORE_ENTRIES] };
  }

  // Parse existing entries: trim, skip blank lines and comments, normalize trailing slash
  const existingNormalized = new Set(
    content.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'))
      .map(l => l.replace(/\/$/, ''))
  );

  const missing = DEFAULT_GITIGNORE_ENTRIES.filter(
    entry => !existingNormalized.has(entry.replace(/\/$/, ''))
  );

  if (missing.length === 0) {
    return { created: false, entriesAdded: [] };
  }

  // Append: add blank line separator if file doesn't end with newline
  const prefix = content.endsWith('\n') ? '' : '\n';
  const appendContent = prefix + GITIGNORE_HEADER + '\n' + missing.join('\n') + '\n';
  await fs.promises.appendFile(gitignorePath, appendContent, 'utf8');
  return { created: false, entriesAdded: missing };
}

// ─── Commit Engine (feature 69) ───────────────────────────────────────────────

let COMMIT_DEBOUNCE_MS = Number(process.env.NOTES_SYNC_COMMIT_DEBOUNCE_MS) || 30000;

let _engineActive = false;
let _engineWorkspacePath = null;
let _commitDebounceTimer = null;
let _claudeBusy = false;
let _pendingCommit = false;
let _onCommitDone = null; // set by startAutoSync(), cleared by stopAutoSync()

function startCommitEngine(workspacePath) {
  _engineWorkspacePath = workspacePath;
  _engineActive = true;
  _claudeBusy = false;
  _pendingCommit = false;
  clearTimeout(_commitDebounceTimer);
  _commitDebounceTimer = null;
}

function stopCommitEngine() {
  clearTimeout(_commitDebounceTimer);
  _commitDebounceTimer = null;
  _engineActive = false;
  _claudeBusy = false;
  _pendingCommit = false;
  _engineWorkspacePath = null;
}

function notifyFileChange() {
  if (!_engineActive) return;
  if (_userPaused) return;  // suppress auto-commits while user has sync paused
  clearTimeout(_commitDebounceTimer);
  _commitDebounceTimer = setTimeout(() => {
    _commitDebounceTimer = null;
    if (_claudeBusy && _pauseDuringClaudeEnabled) {
      _pendingCommit = true;
      return;
    }
    _executeCommit();
  }, COMMIT_DEBOUNCE_MS);
}

function setClaudeBusy(busy) {
  const wasTrue = _claudeBusy;
  _claudeBusy = busy;
  if (busy && _pauseDuringClaudeEnabled) {
    _pauseAutoSync();
  }
  if (wasTrue && !busy && _pauseDuringClaudeEnabled) {
    _resumeAutoSync();
    if (_pendingCommit) {
      _pendingCommit = false;
      _executeCommit();
    }
  }
}

function commitNow({ logSkips = false } = {}) {
  if (!_engineActive) return Promise.resolve({ ok: false, error: 'engine not started' });
  clearTimeout(_commitDebounceTimer);
  _commitDebounceTimer = null;
  if (_claudeBusy) {
    _pendingCommit = true;
    return Promise.resolve({ ok: true, deferred: true });
  }
  return _executeCommit({ logSkips });
}

async function _executeCommit({ logSkips = false } = {}) {
  if (!_engineActive || !_engineWorkspacePath) {
    return { ok: false, error: 'engine not started' };
  }
  return enqueue(async () => {
    const bin = findGitBin();

    let statusOut;
    try {
      const result = await execFileAsync(bin, ['status', '--porcelain'], { cwd: _engineWorkspacePath });
      statusOut = result.stdout;
    } catch (err) {
      process.stderr.write(`sync commit engine: git status failed: ${err.message}\n`);
      _logActivity('error', 'failure', 'Commit failed: git status error');
      return { ok: false, error: err.message };
    }

    if (!statusOut.trim()) {
      if (logSkips) _logActivity('commit', 'skipped', 'No changes to commit');
      return { ok: true, skipped: true };
    }

    try {
      await execFileAsync(bin, ['add', '-A'], { cwd: _engineWorkspacePath });
    } catch (err) {
      process.stderr.write(`sync commit engine: git add failed: ${err.message}\n`);
      _logActivity('error', 'failure', 'Commit failed: git add error');
      return { ok: false, error: err.message };
    }

    const timestamp = new Date().toISOString();
    try {
      await execFileAsync(
        bin,
        ['commit', '-m', `sync: ${timestamp}`],
        {
          cwd: _engineWorkspacePath,
          env: { ...process.env, GIT_AUTHOR_NAME: 'notes-app', GIT_AUTHOR_EMAIL: 'app@notes.local', GIT_COMMITTER_NAME: 'notes-app', GIT_COMMITTER_EMAIL: 'app@notes.local' },
        }
      );
    } catch (err) {
      process.stderr.write(`sync commit engine: git commit failed: ${err.message}\n`);
      _logActivity('error', 'failure', 'Commit failed: ' + err.message);
      return { ok: false, error: err.message };
    }

    _logActivity('commit', 'success', 'Committed changes');
    if (_onCommitDone) _onCommitDone();
    return { ok: true, skipped: false };
  });
}

// ─── Push/Pull Engine (feature 70) ───────────────────────────────────────────

const PUSH_PULL_TIMEOUT_MS = Number(process.env.NOTES_SYNC_PUSH_PULL_TIMEOUT_MS) || 30000;
// Mutable for test manipulation (e.g., splice to [50, 50, 50] for fast retries)
const RETRY_DELAYS = [5000, 15000, 45000];

let _pushPullActive = false;
let _pushPullWorkspacePath = null;
let _pushPullBranch = null;
let _lastPullTimestamp = null;
let _lastPushTimestamp = null;
let _pushPullGeneration = 0;

function startPushPullEngine(workspacePath, branch) {
  _pushPullGeneration++;
  _pushPullWorkspacePath = workspacePath;
  _pushPullBranch = branch;
  _pushPullActive = true;
  _lastPullTimestamp = null;
  _lastPushTimestamp = null;
}

function stopPushPullEngine() {
  _pushPullGeneration++;
  _pushPullActive = false;
  _pushPullWorkspacePath = null;
  _pushPullBranch = null;
  _lastPullTimestamp = null;
  _lastPushTimestamp = null;
}

function getLastSyncTimestamps() {
  return { lastPull: _lastPullTimestamp, lastPush: _lastPushTimestamp };
}

async function _executePull() {
  const gen = _pushPullGeneration;
  return enqueue(async () => {
    if (gen !== _pushPullGeneration) {
      return { ok: false, error: 'engine generation changed (cancelled)' };
    }
    if (!_pushPullActive || !_pushPullWorkspacePath) {
      return { ok: false, error: 'engine not started' };
    }
    const bin = findGitBin();
    transition('syncing');
    try {
      await execFileAsync(bin, ['pull', '--rebase', 'origin', _pushPullBranch], {
        cwd: _pushPullWorkspacePath,
        timeout: PUSH_PULL_TIMEOUT_MS,
      });
      if (gen !== _pushPullGeneration) {
        return { ok: false, error: 'engine generation changed (cancelled)' };
      }
      _lastPullTimestamp = Date.now();
      _logActivity('pull', 'success', 'Pulled changes (rebase)');
      transition('idle');
      return { ok: true };
    } catch (err) {
      if (gen !== _pushPullGeneration) {
        return { ok: false, error: 'engine generation changed (cancelled)' };
      }
      const stderr = err.stderr || '';
      const exitCode = err.code || null;
      if (err.killed) {
        _logActivity('error', 'failure', 'Pull timed out');
        transition('error', { message: 'pull timed out' });
        return { ok: false, errorType: 'network', error: 'pull timed out' };
      }
      const stdout = err.stdout || '';
      const errorType = classifyError(stderr, exitCode, stdout);
      if (errorType === 'conflict') {
        // 1. Abort the failed rebase
        try {
          await execFileAsync(bin, ['rebase', '--abort'], { cwd: _pushPullWorkspacePath });
        } catch { /* ignore abort errors */ }

        // 2. Attempt fallback merge
        let mergeStderr = '';
        let mergeExitCode = null;
        try {
          await execFileAsync(bin, ['pull', '--no-rebase', 'origin', _pushPullBranch], {
            cwd: _pushPullWorkspacePath,
            timeout: PUSH_PULL_TIMEOUT_MS,
          });
          // Merge succeeded cleanly — no conflict
          if (gen !== _pushPullGeneration) {
            return { ok: false, error: 'engine generation changed (cancelled)' };
          }
          _lastPullTimestamp = Date.now();
          _logActivity('pull', 'success', 'Pulled changes (merge)');
          transition('idle');
          return { ok: true };
        } catch (mergeErr) {
          if (gen !== _pushPullGeneration) {
            return { ok: false, error: 'engine generation changed (cancelled)' };
          }
          if (mergeErr.killed) {
            _logActivity('error', 'failure', 'Pull timed out');
            transition('error', { message: 'pull timed out' });
            return { ok: false, errorType: 'network', error: 'pull timed out' };
          }
          mergeStderr = mergeErr.stderr || '';
          mergeExitCode = mergeErr.code || null;
          const mergeStdout = mergeErr.stdout || '';
          const mergeErrorType = classifyError(mergeStderr, mergeExitCode, mergeStdout);
          if (mergeErrorType !== 'conflict') {
            _logActivity(mergeErrorType === 'auth' ? 'auth-fail' : 'error', 'failure', 'Pull failed: ' + (mergeStderr || mergeErr.message));
            transition('error', { message: mergeStderr || mergeErr.message });
            return { ok: false, errorType: mergeErrorType, error: mergeStderr || mergeErr.message };
          }
          // Merge conflict — fall through to extraction
        }

        // 3. Identify conflicted files
        let conflictedFiles = [];
        try {
          const { stdout } = await execFileAsync(bin, ['diff', '--name-only', '--diff-filter=U'], {
            cwd: _pushPullWorkspacePath,
          });
          conflictedFiles = stdout.split('\n').filter(l => l.trim() !== '');
        } catch { /* ignore — conflictedFiles stays empty */ }

        // 4. Extract local (stage 2) and remote (stage 3) versions for each conflicted file
        const conflicts = [];
        for (const filePath of conflictedFiles) {
          let localContent = null;
          let remoteContent = null;
          try {
            const { stdout } = await execFileAsync(bin, ['show', `:2:${filePath}`], {
              cwd: _pushPullWorkspacePath,
            });
            localContent = stdout;
          } catch { /* file doesn't exist on local side */ }
          try {
            const { stdout } = await execFileAsync(bin, ['show', `:3:${filePath}`], {
              cwd: _pushPullWorkspacePath,
            });
            remoteContent = stdout;
          } catch { /* file doesn't exist on remote side */ }
          conflicts.push({ filePath, localContent, remoteContent });
        }

        // 5. Store and signal
        if (gen !== _pushPullGeneration) {
          return { ok: false, error: 'engine generation changed (cancelled)' };
        }
        _conflicts = conflicts;
        const conflictFiles = _conflicts.map(c => c.filePath);
        _logActivity('conflict', 'failure', 'Merge conflict in ' + conflicts.length + ' file(s)');
        transition('conflict', { message: 'merge conflict', files: conflictFiles });
        return { ok: false, errorType: 'conflict', error: 'merge conflict', files: conflictFiles };
      }
      let errorObj = { message: stderr || err.message };
      if (errorType === 'corruption') {
        errorObj.corruption = await checkRepoHealth(_pushPullWorkspacePath);
      }
      _logActivity(errorType === 'auth' ? 'auth-fail' : 'error', 'failure', 'Pull failed: ' + (stderr || err.message));
      transition('error', errorObj);
      return { ok: false, errorType, error: stderr || err.message };
    }
  });
}

async function _executePush() {
  const gen = _pushPullGeneration;
  return enqueue(async () => {
    if (gen !== _pushPullGeneration) {
      return { ok: false, error: 'engine generation changed (cancelled)' };
    }
    if (!_pushPullActive || !_pushPullWorkspacePath) {
      return { ok: false, error: 'engine not started' };
    }
    const bin = findGitBin();
    transition('syncing');
    try {
      await execFileAsync(bin, ['push', 'origin', _pushPullBranch], {
        cwd: _pushPullWorkspacePath,
        timeout: PUSH_PULL_TIMEOUT_MS,
      });
      if (gen !== _pushPullGeneration) {
        return { ok: false, error: 'engine generation changed (cancelled)' };
      }
      _lastPushTimestamp = Date.now();
      _logActivity('push', 'success', 'Pushed to remote');
      transition('idle');
      return { ok: true };
    } catch (err) {
      if (gen !== _pushPullGeneration) {
        return { ok: false, error: 'engine generation changed (cancelled)' };
      }
      const stderr = err.stderr || '';
      const exitCode = err.code || null;
      if (err.killed) {
        _logActivity('error', 'failure', 'Push timed out');
        transition('error', { message: 'push timed out' });
        return { ok: false, errorType: 'network', error: 'push timed out' };
      }
      const errorType = classifyError(stderr, exitCode);
      let errorObj = { message: stderr || err.message };
      if (errorType === 'corruption') {
        errorObj.corruption = await checkRepoHealth(_pushPullWorkspacePath);
      }
      _logActivity(errorType === 'auth' ? 'auth-fail' : 'error', 'failure', 'Push failed: ' + (stderr || err.message));
      transition('error', errorObj);
      return { ok: false, errorType, error: stderr || err.message };
    }
  });
}

async function _executePullWithRetry() {
  const gen = _pushPullGeneration;
  let lastResult = await _executePull();
  if (lastResult.ok) return lastResult;
  if (lastResult.errorType !== 'network') return lastResult;

  for (let i = 0; i < RETRY_DELAYS.length; i++) {
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[i]));
    if (gen !== _pushPullGeneration) {
      return { ok: false, error: 'engine generation changed (cancelled)' };
    }
    lastResult = await _executePull();
    if (lastResult.ok) return lastResult;
    if (lastResult.errorType !== 'network') return lastResult;
  }

  return { ...lastResult, retriesExhausted: true };
}

async function _executePushWithRetry() {
  const gen = _pushPullGeneration;
  let lastResult = await _executePush();
  if (lastResult.ok) return lastResult;
  if (lastResult.errorType !== 'network') return lastResult;

  for (let i = 0; i < RETRY_DELAYS.length; i++) {
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[i]));
    if (gen !== _pushPullGeneration) {
      return { ok: false, error: 'engine generation changed (cancelled)' };
    }
    lastResult = await _executePush();
    if (lastResult.ok) return lastResult;
    if (lastResult.errorType !== 'network') return lastResult;
  }

  return { ...lastResult, retriesExhausted: true };
}

function pullNow() {
  if (!_pushPullActive) return Promise.resolve({ ok: false, error: 'engine not started' });
  return _executePullWithRetry();
}

async function pushNow() {
  const gen = _pushPullGeneration;
  if (!_pushPullActive) return { ok: false, error: 'engine not started' };
  const pullResult = await _executePullWithRetry();
  if (!pullResult.ok) return pullResult;
  if (gen !== _pushPullGeneration) {
    return { ok: false, error: 'engine generation changed (cancelled)' };
  }
  return _executePushWithRetry();
}

// ─── Auto Sync Loop (feature 71) ─────────────────────────────────────────────

let PERIODIC_SYNC_INTERVAL_MS = Number(process.env.NOTES_SYNC_PERIODIC_INTERVAL_MS) || 300000;
const FOCUS_PULL_COOLDOWN_MS = 60000;

let _autoSyncActive = false;
let _periodicTimer = null;
let _lastFocusPullTime = 0;
let _autoSyncPaused = false;
let _pendingSyncAfterClaude = false;
let _userPaused = false;  // user-initiated pause (distinct from Claude-busy pause)

let _syncOnFocusEnabled = true;       // feature 78: sync-on-focus toggle
let _pauseDuringClaudeEnabled = true; // feature 78: pause-during-Claude toggle

function startAutoSync() {
  _autoSyncActive = true;
  _onCommitDone = _triggerPostCommitSync;
  _periodicTimer = setInterval(_triggerPeriodicSync, PERIODIC_SYNC_INTERVAL_MS);
}

function stopAutoSync() {
  _autoSyncActive = false;
  _onCommitDone = null;
  clearInterval(_periodicTimer);
  _periodicTimer = null;
  _autoSyncPaused = false;
  _pendingSyncAfterClaude = false;
  _lastFocusPullTime = 0;
}

async function syncNow() {
  const state = getState();
  if (state === 'conflict' || state === 'error') {
    return { ok: false, error: 'sync blocked by current state' };
  }
  const commitResult = await commitNow({ logSkips: true });
  if (!commitResult.ok) return commitResult;
  const pushResult = await pushNow();
  _resetPeriodicTimer();
  return pushResult;
}

function _triggerPostCommitSync() {
  if (!_autoSyncActive) return;
  const state = getState();
  if (state === 'conflict' || state === 'error') return;
  if (_autoSyncPaused) {
    _pendingSyncAfterClaude = true;
    return;
  }
  pushNow().catch(err => process.stderr.write(`sync auto-loop: post-commit pushNow failed: ${err.message}\n`));
  _resetPeriodicTimer();
}

function _triggerPeriodicSync() {
  if (!_autoSyncActive) return;
  const state = getState();
  if (state === 'conflict' || state === 'error') return;
  if (_autoSyncPaused) {
    _pendingSyncAfterClaude = true;
    return;
  }
  pushNow().catch(err => process.stderr.write(`sync auto-loop: periodic pushNow failed: ${err.message}\n`));
}

function _triggerFocusPull() {
  if (!_syncOnFocusEnabled) return;
  if (!_autoSyncActive) return;
  const state = getState();
  if (state === 'conflict' || state === 'error') return;
  if (_autoSyncPaused) return;
  const now = Date.now();
  if (now - _lastFocusPullTime < FOCUS_PULL_COOLDOWN_MS) return;
  _lastFocusPullTime = now;
  pullNow().catch(err => process.stderr.write(`sync auto-loop: focus pullNow failed: ${err.message}\n`));
}

function _pauseAutoSync() {
  _autoSyncPaused = true;
}

function _resumeAutoSync() {
  if (_userPaused) return;  // user pause takes precedence over Claude-busy resume
  _autoSyncPaused = false;
  if (_pendingSyncAfterClaude) {
    _pendingSyncAfterClaude = false;
    _triggerPostCommitSync();
  }
}

function _resetPeriodicTimer() {
  if (!_autoSyncActive || _periodicTimer === null) return;
  clearInterval(_periodicTimer);
  _periodicTimer = setInterval(_triggerPeriodicSync, PERIODIC_SYNC_INTERVAL_MS);
}

module.exports = {
  // Detection utilities (feature 63)
  getGitStatus,
  findGitBin,
  // State machine (feature 64)
  getState,
  initSyncState,
  transition,
  onStatusChange,
  offStatusChange,
  // Error classifier (feature 64)
  classifyError,
  // Operation queue (feature 64)
  enqueue,
  // Graceful shutdown (feature 64)
  shutdown,
  // Gitignore management (feature 65)
  ensureGitignore,
  // Auth check (feature 67)
  detectAuthMethod,
  checkAuth,
  clearAuthCache,
  // Commit engine (feature 69)
  startCommitEngine,
  stopCommitEngine,
  notifyFileChange,
  setClaudeBusy,
  commitNow,
  // Push/pull engine (feature 70)
  startPushPullEngine,
  stopPushPullEngine,
  pullNow,
  pushNow,
  getLastSyncTimestamps,
  RETRY_DELAYS, // exported for test manipulation (splice to override delays)
  // Auto sync loop (feature 71)
  startAutoSync,
  stopAutoSync,
  syncNow,
  _triggerFocusPull,      // called from main.js on window focus
  _triggerPeriodicSync,   // exported for tests only
  _triggerPostCommitSync, // exported for tests only
  // Conflict detection (feature 72)
  getConflicts,
  clearConflicts,
  // Conflict resolution (feature 73)
  resolveConflict,
  finalizeMerge,
  abortMerge,
  // Activity log (feature 74)
  getActivityLog,
  clearActivityLog,
  // Corrupted state recovery (feature 75)
  checkRepoHealth,
  recoverLockedIndex,
  recoverInterruptedRebase,
  recoverInterruptedMerge,
  recoverDetachedHead,
  recoverReclone,
  listBranches,
  // Second device clone (feature 76)
  cloneRepo,
  checkTargetDirectory,
  // Pause & Disconnect (feature 77)
  readSyncPaused,
  pauseSync,
  resumeSync,
  isSyncPaused,
  disconnectSync,
  // Sync user settings (feature 78)
  readAllSyncSettings,
  writeSyncSettings,
  applySyncSettings,
  SYNC_SETTINGS_DEFAULTS,
};
