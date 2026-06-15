global.__nodeRequire = require;
const { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, Menu, protocol } = require("electron");
const os = require("os");
const path = require("path");
const fs = require("fs");

// Use a separate userData folder (and Keychain item) for dev vs packaged builds
if (!app.isPackaged) {
  app.setName('toutkit-dev');
}

// Packaged binaries default to the prod stage; dev launches still default to 'dev'
// via auth.js / sync-api.js. Override by setting APP_STAGE explicitly.
if (app.isPackaged && !process.env.APP_STAGE) {
  process.env.APP_STAGE = 'prod';
}

// About-panel metadata — macOS renders this natively via the { role: 'about' }
// menu item; Windows/Linux reach the same info through the Help menu below.
app.setAboutPanelOptions({
  applicationName: 'ToutKit',
  applicationVersion: app.getVersion(),
  copyright: 'Copyright (c) 2026 Helicase Space LLC\nLicensed under AGPL-3.0-only. See LICENSE.',
  website: 'https://toutkit.com',
  authors: ['Helicase Space LLC'],
});
const { execSync, execFileSync, execFile, spawn } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const chokidar = require("chokidar");
const { activeProvider, generateSessionId, listProviders, setActiveProvider, setActiveModel, getActiveModel, setActiveEffort, getActiveEffort, setActivePermissionMode, getActivePermissionMode, refreshModels, registerOpenAICompatEndpoints, registerOpenClawRemoteEndpoints } = require("./providers");
const { getRemotePresets, mergePresetsWithEndpoints, resetEndpointToPreset } = require('./providers/openai-compat-presets');
const { getRemoteManifest, downloadTemplateFolders } = require('./providers/remote-templates');
const NOTE_CSS = fs.readFileSync(path.join(__dirname, 'note-viewer.css'), 'utf8');
// Share variant: shared/exported HTML can't use webview.insertCSS or [data-theme],
// so swap the [data-theme="light"] block for prefers-color-scheme so the rendered
// page follows the reader's OS preference.
const SHARE_NOTE_CSS = NOTE_CSS.replace(
  /:root\[data-theme="light"\]\s*\{([\s\S]*?)\}/,
  '@media (prefers-color-scheme: light) {\n  :root {$1}\n}'
);
const prefs = require("./preferences");

function getThemeAttr() {
  const saved = prefs.getTheme();
  const theme = saved || (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  return theme === 'light' ? ' data-theme="light"' : '';
}
const conversations = require('./conversations');
const sync = require('./sync');
// SEARCH DISABLED
// const searchIndex = require('./search-index');
// const { parseSearchQuery } = require('./search-query-parser');
// GRAPH DISABLED — builder was only used by graph:getData
// const builder = require('./search-index-builder');
// const searchIncremental = require('./search-incremental');
const Database = require('better-sqlite3');
// TAGS/BACKLINKS DISABLED
// const tagsIndex = require('./tags-index');
const templatesRegistry = require('./templates-registry');
const builtInTemplates = require('./built-in-templates');
const favorites = require('./favorites');
// const backlinksIndex = require('./backlinks-index');
// const { parseTagsFromFile, writeTagsToFile, isValidTagName } = require('./tags');
const exportModule = require('./export');
require('./pdf-export'); // registers real PDF converter (feature 103)
require('./markdown-export'); // registers Markdown converter (feature 104)
require('./plaintext-export'); // registers plain text converter (feature 105)
const { bulkExport } = require('./bulk-export'); // bulk export to ZIP (feature 106)
const { importMarkdownFiles } = require('./markdown-import'); // Markdown import (feature 107)
const { importPlaintextFiles } = require('./plaintext-import'); // Plain text import (feature 108)
const { scanFolder, scanFiles, executeBatchImport } = require('./batch-import'); // Batch import (feature 109)
const auth = require('./auth');
const github = require('./github-auth');
const shareRenderer = require('./share-renderer');
const syncManager = require('./sync-manager');
const serverSyncManager = require('./server-sync-manager');
const syncIgnore = require('./sync-ignore');
const noteDb = require('./note-db');
const contextSnapshot = require('./context-snapshot');
const terminalManager = require('./terminal-manager');
let _indexController = null;

// ─── Shell environment resolution ────────────────────────────────────────────
// macOS GUI apps launched from Finder inherit a minimal environment that lacks
// user-installed tools and env vars (pyenv, nvm, API keys, etc.). Resolve the
// user's full interactive login shell environment once at startup.
function fixShellEnv() {
  if (process.platform === 'win32') return;
  try {
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    const output = execSync(`${shell} -ilc "env -0"`, {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of output.split('\0')) {
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const key = line.slice(0, idx);
      const val = line.slice(idx + 1);
      // Skip shell-internal vars that shouldn't be overridden
      if (key === '_' || key === 'SHLVL' || key === 'PWD' || key === 'OLDPWD') continue;
      process.env[key] = val;
    }
  } catch {}
}

let mainWindow;
let workspacePath = null;
let watcher = null;
let watchDebounceTimer = null;
const _contentChangeTimers = new Map(); // absPath → timeout (per-file debounce for note:contentChanged)
let _favUnlinkTimer = null;
let _tagsChangedTimer = null;
let _backlinksChangedTimer = null;

// ─── Note Security Settings (per-workspace) ──────────────────────────────────
const SECURITY_DEFAULTS = {
  allowFileAccess: false,
  allowExternalNetwork: true,
  allowNavigation: false,
  allowPopups: false,
};
let _securitySettings = { ...SECURITY_DEFAULTS };

function securitySettingsPath() {
  if (!workspacePath) return null;
  return path.join(workspacePath, '.notes-app', 'security.json');
}

function readSecuritySettings() {
  const p = securitySettingsPath();
  if (!p) return { ...SECURITY_DEFAULTS };
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    // Only allow known boolean keys, merge with defaults
    const result = { ...SECURITY_DEFAULTS };
    for (const key of Object.keys(SECURITY_DEFAULTS)) {
      if (typeof data[key] === 'boolean') result[key] = data[key];
    }
    return result;
  } catch {
    return { ...SECURITY_DEFAULTS };
  }
}

function writeSecuritySettings(settings) {
  const p = securitySettingsPath();
  if (!p) return;
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  // Only persist known keys
  const clean = {};
  for (const key of Object.keys(SECURITY_DEFAULTS)) {
    clean[key] = typeof settings[key] === 'boolean' ? settings[key] : SECURITY_DEFAULTS[key];
  }
  fs.writeFileSync(p, JSON.stringify(clean, null, 2));
  _securitySettings = clean;
}

const TEMPLATES_DIR_NAME = '_templates';
const IGNORED_DIRS = new Set(['.git', '.claude', 'node_modules', '.DS_Store', '.Trash', '.vscode', '.notes-app', '.context', TEMPLATES_DIR_NAME, 'storage', 'AGENTS.md']);
let claudeProc = null;
let currentSessionId = null;
let messageCount = 0; // track messages in current conversation
// Feature 100: stores the last prompt sent to Claude (used by test IPC handler)
let _lastClaudePrompt = null;
const noteSqlCache = new Map(); // Map<noteId, Database> — open better-sqlite3 handles per note
const noteSqlReadonlyCache = new Map(); // Map<noteId, Database> — read-only better-sqlite3 handles
let syncSetupMenuItem = null;
let templatesRestoreMenuItem = null;
let _availablePresets = []; // Presets not yet added by the user (populated at startup)
let _allPresets = [];       // All known presets (remote or fallback, for reset)
let _presetsReady = Promise.resolve(); // resolves when preset init completes
let _remoteManifest = null;    // Cached remote manifest { id: { version } }
let _remoteTemplatesDir = null; // Path to extracted templates dir from tarball (temp)
let _remoteTmpDir = null;       // Temp dir to clean up

// Register note:// as a privileged scheme.
// MUST be called before app.whenReady() — Electron hard requirement.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'note',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

// ─── Single instance lock (required for Windows/Linux OAuth deep link) ────────
// Must be called before app.whenReady(). If another instance is running,
// quit — the running instance handles the OAuth callback via 'second-instance'.
const _gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!_gotSingleInstanceLock) {
  app.quit();
}

// ─── Register toutkit:// as the system deep link handler ──────────────────
// Only in production (packaged). In dev mode, auth.js uses a loopback HTTP
// server instead, because setAsDefaultProtocolClient doesn't work reliably
// on macOS when the app isn't packaged.
if (app.isPackaged) {
  app.setAsDefaultProtocolClient('toutkit');

  // ─── macOS: handle deep link when app is already running ───────────────────
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (url.startsWith('toutkit://auth/callback')) {
      auth.handleCallback(url).then(() => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });
    }
  });
}

// ─── Second-instance: focus existing window + handle deep link (prod) ───────
app.on('second-instance', (_event, argv) => {
  const url = app.isPackaged
    ? argv.find(arg => arg.startsWith('toutkit://auth/callback'))
    : null;
  if (url) {
    auth.handleCallback(url).then(() => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  } else {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  }
});

// Determine workspace path: env var, CLI arg, or saved preference
function resolveWorkspacePath() {
  // Check env var first (used by tests)
  if (process.env.TOUTKIT_WORKSPACE) {
    return path.resolve(process.env.TOUTKIT_WORKSPACE);
  }
  // Check for command-line arg (npm start -- /path/to/workspace)
  const userArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (userArgs.length > 0 && userArgs[0]) {
    return path.resolve(userArgs[0]);
  }
  // Check saved preference
  const saved = prefs.getLastWorkspace();
  if (saved && fs.existsSync(saved)) {
    return saved;
  }
  return null;
}

function hasGit(dirPath) {
  return fs.existsSync(path.join(dirPath, ".git"));
}

function hasClaude(dirPath) {
  return fs.existsSync(path.join(dirPath, ".claude"));
}

function initGit(dirPath) {
  execFileSync(sync.findGitBin(), ["init"], { cwd: dirPath, stdio: "ignore" });
}

/**
 * Ensures the _templates directory exists inside wsPath.
 * Creates it if missing. Returns the full path on success, or null on error.
 * On read-only workspace, sends a templates:error event to the renderer.
 */
function ensureTemplatesDir(wsPath) {
  const templatesPath = path.join(wsPath, TEMPLATES_DIR_NAME);
  try {
    if (!fs.existsSync(templatesPath)) {
      fs.mkdirSync(templatesPath, { recursive: true });
    } else {
      const stat = fs.statSync(templatesPath);
      if (!stat.isDirectory()) {
        mainWindow?.webContents.send('templates:error',
          'Cannot create _templates folder: a file with that name already exists.');
        return null;
      }
    }
    return templatesPath;
  } catch (err) {
    const msg = (err.code === 'EACCES' || err.code === 'EROFS')
      ? 'Cannot create _templates folder: workspace is read-only.'
      : `Cannot create _templates folder: ${err.message}`;
    mainWindow?.webContents.send('templates:error', msg);
    return null;
  }
}

/**
 * Adds _templates/ to .gitignore if the gitignoreTemplates preference is true (default).
 * Only modifies .gitignore if it already exists — does not create it.
 * Idempotent: skips if _templates/ is already listed.
 */
async function ensureTemplatesGitignore(wsPath) {
  if (!prefs.getGitignoreTemplates()) return;
  const gitignorePath = path.join(wsPath, '.gitignore');
  let content;
  try {
    content = await fs.promises.readFile(gitignorePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return; // no .gitignore yet — skip
    throw err;
  }
  const lines = content.split('\n').map(l => l.trim());
  if (lines.some(l => l === '_templates/' || l === '_templates')) return; // already present
  const entry = '\n# templates folder\n_templates/\n';
  await fs.promises.appendFile(gitignorePath, entry, 'utf8');
}

async function openWorkspace(wsPath) {
  console.log('[openWorkspace] called at', Date.now(), new Error().stack.split('\n').slice(1, 5).join(' | '));
  workspacePath = wsPath;
  terminalManager.setWorkspacePath(wsPath);
  contextSnapshot.writeMeta(wsPath);
  _loadLoggingEnabled(); // load per-workspace logging toggle
  _securitySettings = readSecuritySettings(); // load per-workspace security settings
  favorites.reset(); // clear stale in-memory state from previous workspace (feature 118)
  favorites.init(wsPath); // load per-workspace favorites from disk — must run before any async op (feature 118/123)
  // Startup stale-favorites cleanup (feature 123)
  {
    const stale = favorites.list().filter(relPath => !fs.existsSync(path.join(wsPath, relPath)));
    if (stale.length > 0) {
      for (const relPath of stale) {
        favorites.remove(wsPath, relPath);
      }
      console.log(`[favorites] Startup cleanup: removed ${stale.length} stale entr${stale.length === 1 ? 'y' : 'ies'}`);
    }
  }
  sync.stopAutoSync();
  sync.stopCommitEngine();
  sync.stopPushPullEngine();
  if (syncSetupMenuItem) syncSetupMenuItem.enabled = true;
  prefs.setLastWorkspace(wsPath);
  if (!fs.existsSync(wsPath)) {
    fs.mkdirSync(wsPath, { recursive: true });
  }
  const templatesPath = ensureTemplatesDir(wsPath); // feature 111: create _templates/ if missing
  if (templatesPath) {
    templatesRegistry.init(templatesPath);
    templatesRegistry.buildRegistry();
    // Seed remote built-in templates asynchronously (non-blocking)
    getRemoteManifest().then(async (manifest) => {
      _remoteManifest = manifest;
      if (!manifest) return;
      // Check if any templates need updating before downloading the tarball
      const result = await downloadTemplateFolders();
      if (!result) return;
      // Clean up previous temp dir if any
      if (_remoteTmpDir) {
        try { fs.rmSync(_remoteTmpDir, { recursive: true, force: true }); } catch {}
      }
      _remoteTmpDir = result.tmpDir;
      _remoteTemplatesDir = result.templatesDir;
      const written = builtInTemplates.seedBuiltInTemplates(templatesPath, manifest, result.templatesDir);
      if (written.length > 0) {
        templatesRegistry.buildRegistry();
        mainWindow?.webContents.send('templates:updated', templatesRegistry.getAll());
      }
      // Sync component templates to workspace
      if (result.componentTemplatesDir) {
        syncComponentTemplates(wsPath, result.componentTemplatesDir);
      }
    }).catch(() => {});
  }
  if (templatesRestoreMenuItem) templatesRestoreMenuItem.enabled = true;
  syncIgnore.ensureSyncignore(wsPath);
  watchWorkspace();
  if (templatesPath) {
    templatesRegistry.setReady(true);
  }
  const gitStatus = await sync.getGitStatus(wsPath);
  let healthReport = null;
  if (gitStatus.isRepo) {
    healthReport = await sync.checkRepoHealth(wsPath);
  }
  sync.initSyncState(gitStatus);
  // Load and apply user sync settings (feature 78)
  if (gitStatus.isRepo) {
    const settings = await sync.readAllSyncSettings(wsPath);
    sync.applySyncSettings(settings);
  }
  if (gitStatus.isRepo && (!healthReport || healthReport.healthy)) {
    sync.startCommitEngine(wsPath);
  }
  if (gitStatus.isRepo && gitStatus.hasRemote && gitStatus.branch && (!healthReport || healthReport.healthy)) {
    sync.startPushPullEngine(wsPath, gitStatus.branch);
    sync.startAutoSync();
    // Restore persisted pause state (feature 77)
    const wasPaused = await sync.readSyncPaused(wsPath);
    if (wasPaused) {
      await sync.pauseSync(wsPath);
    }
  }
  if (gitStatus.isRepo) {
    await ensureTemplatesGitignore(wsPath); // feature 111: add _templates/ to .gitignore
    await ensureProviderFilesGitignore(wsPath); // multi-provider instruction files
    await ensureNotesAppGitignore(wsPath); // AWS sync state
  }
  // Ensure all provider instruction files exist and sync from remote.
  // Runs on every workspace open (not just bootstrap) so existing projects
  // get AGENTS.md / GEMINI.md created and kept up-to-date.
  syncAllProviderInstructions(wsPath).catch(() => {});
  console.log('[workspace:loaded] sending at', Date.now(), new Error().stack.split('\n').slice(1, 5).join(' | '));
  mainWindow.webContents.send("workspace:loaded", {
    path: wsPath,
    tree: buildFileTree(wsPath),
    gitStatus,
    healthReport,
  });

  // AWS sync: init engines and trigger initial sync on workspace open (feature 146)
  if (auth.isLoggedIn() && prefs.getAwsSyncEnabled()) {
    syncManager.init(wsPath).catch(() => {});
  }

  // Server sync (SSH/SFTP): init endpoints that have sync enabled
  _initServerSyncEndpoints(wsPath);

  // SEARCH/TAGS/BACKLINKS DISABLED — AbortController no longer needed
  // if (_indexController) _indexController.abort();
  // _indexController = new AbortController();
  // const { signal: _indexSignal } = _indexController;

  // searchIndex.init(wsPath);
  // searchIncremental.setReady(false); // queue events until initial build completes
  // TAGS/BACKLINKS DISABLED
  // tagsIndex.init();
  // tagsIndex.setReady(false); // queue events until initial build completes
  // backlinksIndex.init();
  // backlinksIndex.setReady(false); // queue events until initial build completes
  // builder.buildIndex(wsPath, {
  //   onProgress: (current, total) => {
  //     mainWindow?.webContents.send('search:indexProgress', { current, total });
  //   },
  //   signal: _indexSignal,
  // }).then(summary => {
  //   mainWindow?.webContents.send('search:indexComplete', summary);
  //   searchIncremental.setReady(true); // replay queued events and go live
  // }).catch(err => {
  //   if (err.name !== 'AbortError') {
  //     console.error('[search-builder] Indexing failed:', err);
  //     mainWindow?.webContents.send('search:indexError', { message: err.message });
  //   }
  //   // On abort or error, stay in queued mode — stop() will clear on workspace switch.
  // });

  // TAGS/BACKLINKS DISABLED
  // tagsIndex.buildIndex(wsPath, { signal: _indexSignal }).then(() => {
  //   tagsIndex.setReady(true); // replay queued events and go live
  // }).catch(err => {
  //   if (err.name !== 'AbortError') {
  //     console.error('[tags-index] Build failed:', err);
  //   }
  // });

  // backlinksIndex.buildIndex(wsPath, { signal: _indexSignal }).then(() => {
  //   backlinksIndex.setReady(true); // replay queued events and go live
  // }).catch(err => {
  //   if (err.name !== 'AbortError') {
  //     console.error('[backlinks-index] Build failed:', err);
  //   }
  // });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    icon: path.join(__dirname, "assets", "icon.png"),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      webviewTag: true,
    },
  });
  mainWindow.loadFile("renderer/index.html");

  sync.onStatusChange((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:statusChanged', event);
    }
  });

  const isMac = process.platform === 'darwin';
  const menuTemplate = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    ...(!isMac ? [{
      label: 'File',
      submenu: [{ role: 'quit' }],
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
          // TAGS/BACKLINKS/GRAPH DISABLED
          // {
          //   label: 'Graph View',
          //   accelerator: 'CmdOrCtrl+Shift+G',
          //   click() {
          //     mainWindow?.webContents.send('graph:open');
          //   },
          // },
        { type: 'separator' },
        {
          label: 'Toggle Terminal',
          accelerator: 'CmdOrCtrl+`',
          click() {
            if (mainWindow) terminalManager.toggleTerminalWindow(mainWindow, workspacePath);
          },
        },
      ],
    },
    { role: 'viewMenu' },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }] : []),
      ],
    },
    {
      label: 'Templates',
      submenu: [
        {
          id: 'templates-restore-menuitem',
          label: 'Restore Default Templates\u2026',
          enabled: false,
          async click() {
            if (!workspacePath) return;
            const manifest = _remoteManifest || await getRemoteManifest();
            if (!manifest) return;
            let sourceDir = _remoteTemplatesDir;
            if (!sourceDir) {
              const result = await downloadTemplateFolders();
              if (!result) return;
              if (_remoteTmpDir) {
                try { fs.rmSync(_remoteTmpDir, { recursive: true, force: true }); } catch {}
              }
              _remoteTmpDir = result.tmpDir;
              _remoteTemplatesDir = result.templatesDir;
              sourceDir = result.templatesDir;
            }
            const tplPath = path.join(workspacePath, TEMPLATES_DIR_NAME);
            const restored = builtInTemplates.restoreBuiltInTemplates(tplPath, manifest, sourceDir);
            templatesRegistry.buildRegistry();
            mainWindow?.webContents.send('templates:restoreComplete', { restored });
          },
        },
      ],
    },
    {
      label: 'Sync',
      submenu: [
        {
          id: 'sync-setup-menuitem',
          label: 'Set Up Sync\u2026',
          enabled: false,
          click() {
            if (mainWindow) mainWindow.webContents.send('sync:openSetup');
          },
        },
      ],
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        { label: 'About ToutKit', role: 'about' },
        { type: 'separator' },
        {
          label: 'Contact Support',
          click() {
            shell.openExternal('mailto:support@helicase.space');
          },
        },
        { type: 'separator' },
        {
          // AGPL-3.0 §13: a network-facing application must make its source
          // available to users. ToutKit's sync features trigger this clause.
          label: 'View Source Code (AGPL-3.0)',
          click() {
            shell.openExternal('https://github.com/toutkit/toutkit');
          },
        },
        {
          label: 'Third-Party Licenses',
          click() {
            shell.openExternal('https://github.com/toutkit/toutkit/blob/main/THIRD_PARTY_LICENSES.md');
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  syncSetupMenuItem = Menu.getApplicationMenu()?.getMenuItemById('sync-setup-menuitem') || null;
  templatesRestoreMenuItem = Menu.getApplicationMenu()?.getMenuItemById('templates-restore-menuitem') || null;

  mainWindow.on('focus', () => {
    sync._triggerFocusPull();
  });

  mainWindow.webContents.once("did-finish-load", async () => {
    const resolved = resolveWorkspacePath();
    if (resolved) {
      // Auto-open last workspace (or env/CLI arg)
      bootstrapWorkspace(resolved);
      await openWorkspace(resolved);
    }
    // Otherwise renderer shows the welcome screen
  });
}

app.whenReady().then(async () => {
  fixShellEnv();

  // Register the note:// protocol handler.
  // Serves files from the workspace: note://notes/<relative-path>
  protocol.handle('note', (request) => {
    if (!workspacePath) {
      return new Response('No workspace open', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }

    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Invalid URL', { status: 400, headers: { 'Content-Type': 'text/plain' } });
    }

    // ── note://notes/<relative-path> — serve raw workspace file ──────────────
    if (url.hostname === 'notes') {
      const relativePath = decodeURIComponent(url.pathname);
      // Reject path traversal attempts (defense-in-depth).
      const segments = relativePath.split('/');
      if (segments.includes('..')) {
        return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
      }
      const resolvedPath = path.resolve(path.join(workspacePath, relativePath));

      if (!isInsideWorkspace(resolvedPath)) {
        return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
      }
      if (!fs.existsSync(resolvedPath)) {
        return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
      }
      try {
        const data = fs.readFileSync(resolvedPath);
        return new Response(data, {
          status: 200,
          headers: { 'Content-Type': getMimeType(resolvedPath) },
        });
      } catch {
        return new Response('Read error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
      }
    }

    // ── note://viewer/<type>/<path> — wrapped viewer routes ──────────────────
    if (url.hostname === 'viewer') {
      const pathParts = url.pathname.replace(/^\//, '').split('/');
      const viewType = pathParts[0];
      const relPath = decodeURIComponent(pathParts.slice(1).join('/'));
      const relSegments = relPath.split('/');
      if (relSegments.includes('..')) {
        return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
      }

      if (viewType === 'text') {
        const resolvedPath = path.resolve(path.join(workspacePath, relPath));
        if (!isInsideWorkspace(resolvedPath)) {
          return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
        }
        let text;
        try {
          text = fs.readFileSync(resolvedPath, 'utf8');
        } catch {
          text = '(Unable to read file)';
        }
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const html = `<!DOCTYPE html><html${getThemeAttr()}><head><meta charset="utf-8"><style>${NOTE_CSS}</style></head><body><pre><code>${escaped}</code></pre></body></html>`;
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }

      if (viewType === 'image') {
        const resolvedPath = path.resolve(path.join(workspacePath, relPath));
        if (!isInsideWorkspace(resolvedPath)) {
          return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
        }
        let data, mimeType;
        try {
          data = fs.readFileSync(resolvedPath).toString('base64');
          mimeType = getMimeType(resolvedPath);
        } catch {
          data = null;
        }
        const imgHtml = data
          ? `<img src="data:${mimeType};base64,${data}" alt="" style="max-width:100%;max-height:90vh;object-fit:contain;">`
          : `<p style="text-align:center;color:var(--text-muted);margin-top:40vh;">Unable to load image</p>`;
        const imgCss = `${NOTE_CSS} body { display:flex; align-items:center; justify-content:center; min-height:100vh; }`;
        const html = `<!DOCTYPE html><html${getThemeAttr()}><head><meta charset="utf-8"><style>${imgCss}</style></head><body>${imgHtml}</body></html>`;
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }

      if (viewType === 'pdf') {
        const resolvedPath = path.resolve(path.join(workspacePath, relPath));
        if (!isInsideWorkspace(resolvedPath)) {
          return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
        }
        try {
          const data = fs.readFileSync(resolvedPath);
          return new Response(data, { status: 200, headers: { 'Content-Type': 'application/pdf' } });
        } catch {
          const html = `<!DOCTYPE html><html${getThemeAttr()}><head><meta charset="utf-8"><style>${NOTE_CSS}</style></head><body><p style="text-align:center;color:var(--text-muted);margin-top:40vh;">Unable to load PDF</p></body></html>`;
          return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
        }
      }

      if (viewType === 'trytext') {
        const resolvedPath = path.resolve(path.join(workspacePath, relPath));
        if (!isInsideWorkspace(resolvedPath)) {
          return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
        }
        try {
          const buf = fs.readFileSync(resolvedPath);
          // Check for binary content (null bytes in first 8KB)
          const sample = buf.slice(0, 8192);
          if (sample.includes(0)) {
            const filename = relPath.split('/').pop() || 'this file';
            const escaped = filename.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const html = `<!DOCTYPE html><html${getThemeAttr()}><head><meta charset="utf-8"><style>${NOTE_CSS}</style></head><body><p style="text-align:center;color:var(--text-muted);margin-top:40vh;">Preview not available for <strong>${escaped}</strong></p></body></html>`;
            return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
          }
          const text = buf.toString('utf8');
          const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const html = `<!DOCTYPE html><html${getThemeAttr()}><head><meta charset="utf-8"><style>${NOTE_CSS}</style></head><body><pre><code>${escaped}</code></pre></body></html>`;
          return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
        } catch {
          const filename = relPath.split('/').pop() || 'this file';
          const escaped = filename.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const html = `<!DOCTYPE html><html${getThemeAttr()}><head><meta charset="utf-8"><style>${NOTE_CSS}</style></head><body><p style="text-align:center;color:var(--text-muted);margin-top:40vh;">Unable to load <strong>${escaped}</strong></p></body></html>`;
          return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
        }
      }

      if (viewType === 'unsupported') {
        const filename = relPath || 'this file';
        const escaped = filename.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const html = `<!DOCTYPE html><html${getThemeAttr()}><head><meta charset="utf-8"><style>${NOTE_CSS}</style></head><body><p style="text-align:center;color:var(--text-muted);margin-top:40vh;">Preview not available for <strong>${escaped}</strong></p></body></html>`;
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }

      return new Response('Unknown viewer type', { status: 400, headers: { 'Content-Type': 'text/plain' } });
    }

    return new Response('Unknown host', { status: 400, headers: { 'Content-Type': 'text/plain' } });
  });

  // Fetch up-to-date model lists in background (non-blocking, falls back to hard-coded)
  refreshModels().then(() => {
    mainWindow?.webContents.send('models:refreshed');
  }).catch(() => {});

  // Fetch presets alongside models (non-blocking, falls back to hardcoded)
  _presetsReady = getRemotePresets().then((presets) => {
    _allPresets = presets;
    const saved = prefs.getOpenaiCompatEndpoints();
    const { endpoints, available } = mergePresetsWithEndpoints(presets, saved);
    _availablePresets = available;
    registerOpenAICompatEndpoints(endpoints);
  }).catch(() => {
    // Fallback: register whatever is saved, no available presets
    registerOpenAICompatEndpoints(prefs.getOpenaiCompatEndpoints());
  });

  // Feature 150: Register saved remote OpenClaw endpoints at startup
  registerOpenClawRemoteEndpoints(prefs.getOpenclawRemoteEndpoints());

  createWindow();

  // ─── Auth: initialize on startup ─────────────────────────────────────────────
  // Relay auth state changes to renderer
  auth.onAuthStateChanged((user) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:stateChanged', user);
    }
    // AWS sync: init/clear on login/logout (feature 146)
    if (user && workspacePath && prefs.getAwsSyncEnabled()) {
      syncManager.init(workspacePath).catch(() => {});
    } else if (!user) {
      syncManager.clearState();
    }
  });
  await auth.init();

  // ─── GitHub: initialize on startup (gist-backed sharing) ─────────────────────
  github.onStateChanged((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('github:stateChanged', state);
    }
  });
  github.init();
  shareRenderer.init();

  if (prefs.getAwsSyncEnabled()) {
    syncManager.start();  // starts periodic + connectivity timers (feature 146)
    // Restore persisted pause state
    if (prefs.getAwsSyncPaused()) {
      syncManager.pause();
    }
  }

  // Forward sync-manager events to renderer (feature 146)
  syncManager.on('statusChanged', (status) => {
    mainWindow?.webContents.send('aws-sync:statusChanged', status);
  });
  // Backward compat: forward content sync results for conflict banner (feature 143)
  syncManager.on('contentSynced', (result) => {
    mainWindow?.webContents.send('aws-sync:contentStatusChanged', {
      event: 'sync-complete',
      uploaded: result.uploaded,
      downloaded: result.downloaded,
      conflicts: result.conflicts,
    });
    if (result.downloaded > 0 || result.conflicts?.length > 0) {
      mainWindow?.webContents.send('notes:updated', buildFileTree(workspacePath));
    }
  });
  syncManager.on('contentConflict', (conflict) => {
    mainWindow?.webContents.send('aws-sync:contentStatusChanged', {
      event: 'conflict',
      conflict,
    });
    mainWindow?.webContents.send('notes:updated', buildFileTree(workspacePath));
  });
  syncManager.on('conflictsChanged', () => {
    mainWindow?.webContents.send('notes:updated', buildFileTree(workspacePath));
  });

  // Forward server-sync-manager events to renderer (SSH/SFTP sync)
  serverSyncManager.on('statusChanged', (status) => {
    mainWindow?.webContents.send('server-sync:statusChanged', status);
  });
  serverSyncManager.on('contentSynced', (result) => {
    mainWindow?.webContents.send('server-sync:contentStatusChanged', {
      event: 'sync-complete',
      uploaded: result.uploaded,
      downloaded: result.downloaded,
      conflicts: result.conflicts,
    });
    if (result.downloaded > 0 || result.conflicts?.length > 0) {
      mainWindow?.webContents.send('notes:updated', buildFileTree(workspacePath));
    }
  });
  serverSyncManager.on('contentConflict', (conflict) => {
    mainWindow?.webContents.send('server-sync:contentStatusChanged', {
      event: 'conflict',
      conflict,
    });
    mainWindow?.webContents.send('notes:updated', buildFileTree(workspacePath));
  });
  serverSyncManager.on('conflictsChanged', () => {
    mainWindow?.webContents.send('notes:updated', buildFileTree(workspacePath));
  });

  // ─── Auth: handle cold-start deep link (Windows/Linux, production only) ─────
  // If the packaged app was launched via toutkit:// URL, the callback URL is
  // in process.argv. In dev mode, the loopback HTTP server handles callbacks.
  if (app.isPackaged) {
    const _coldStartDeepLink = process.argv.find(arg => arg.startsWith('toutkit://auth/callback'));
    if (_coldStartDeepLink) {
      auth.handleCallback(_coldStartDeepLink);
    }
  }
});

// Security controls for note <webview> contents.
// Settings are read from _securitySettings (loaded per-workspace).
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;

  // Block requests from note webviews based on security settings.
  contents.session.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    // Block file:// unless explicitly allowed
    if (!_securitySettings.allowFileAccess && url.startsWith('file://')) {
      callback({ cancel: true });
      return;
    }
    // Block http/https if external network is disallowed
    if (!_securitySettings.allowExternalNetwork && (url.startsWith('http://') || url.startsWith('https://'))) {
      callback({ cancel: true });
      return;
    }
    callback({});
  });

  // Prevent notes from navigating the webview to external URLs.
  contents.on('will-navigate', (event, url) => {
    if (!_securitySettings.allowNavigation && !url.startsWith('note://')) {
      event.preventDefault();
    }
  });

  // Prevent notes from opening popup windows (checks setting at call time).
  contents.setWindowOpenHandler(() => {
    if (_securitySettings.allowPopups) return { action: 'allow' };
    return { action: 'deny' };
  });
});

app.on("window-all-closed", () => app.quit());

function stopWatching() {
  clearTimeout(watchDebounceTimer);
  for (const t of _contentChangeTimers.values()) clearTimeout(t);
  _contentChangeTimers.clear();
  clearTimeout(_favUnlinkTimer);
  clearTimeout(_tagsChangedTimer);
  clearTimeout(_backlinksChangedTimer);
  // SEARCH DISABLED — searchIncremental.stop();
  // TAGS/BACKLINKS DISABLED
  // tagsIndex.stop();
  // backlinksIndex.stop();
  templatesRegistry.stop();
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

app.on('before-quit', async (e) => {
  terminalManager.cleanup();
  if (workspacePath) contextSnapshot.clearAll(workspacePath);
  stopWatching();
  // Clean up remote templates temp dir
  if (_remoteTmpDir) {
    try { fs.rmSync(_remoteTmpDir, { recursive: true, force: true }); } catch {}
    _remoteTmpDir = null;
    _remoteTemplatesDir = null;
  }
  for (const db of noteSqlCache.values()) {
    try { db.close(); } catch {}
  }
  noteSqlCache.clear();
  for (const db of noteSqlReadonlyCache.values()) {
    try { db.close(); } catch {}
  }
  noteSqlReadonlyCache.clear();
  sync.stopAutoSync();
  sync.stopCommitEngine();
  sync.stopPushPullEngine();
  if (sync.getState() === 'syncing') {
    e.preventDefault();
    await sync.shutdown();
    app.quit();
  }
});

// --- Workspace helpers ---

function stripHtmlTags(str) {
  return str.replace(/<[^>]*>/g, "");
}

function extractTitle(filePath, fallbackName) {
  const _fallback = fallbackName || path.basename(filePath, ".html");
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    function tryExtract(regex) {
      const m = content.match(regex);
      if (!m) return null;
      const text = stripHtmlTags(m[1]).trim();
      return text || null;
    }
    const dataTitle = content.match(/data-title="([^"]+)"/);
    if (dataTitle) return dataTitle[1];
    return tryExtract(/<title[^>]*>([\s\S]*?)<\/title>/i)
        || tryExtract(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
        || tryExtract(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/i)
        || _fallback;
  } catch {
    return _fallback;
  }
}

function buildFileTree(dirPath) {
  if (!dirPath) return null;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const children = [];

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;

      const fullPath = path.join(dirPath, entry.name);
      let mtime = 0;
      try { mtime = fs.statSync(fullPath).mtimeMs; } catch {}

      if (entry.isDirectory()) {
        const indexHtmlPath = path.join(fullPath, 'index.html');
        if (fs.existsSync(indexHtmlPath)) {
          // Note folder: emit a leaf note node (no children)
          children.push({
            name: entry.name,
            path: fullPath,
            type: 'note',
            mtime,
            title: extractTitle(indexHtmlPath, entry.name),
          });
        } else {
          const subtree = buildFileTree(fullPath);
          children.push({
            name: entry.name,
            path: fullPath,
            type: 'folder',
            mtime,
            children: subtree ? subtree.children : [],
          });
        }
      } else if (entry.isFile()) {
        const item = {
          name: entry.name,
          path: fullPath,
          type: 'file',
          mtime,
        };
        if (entry.name.endsWith('.html')) {
          item.title = extractTitle(fullPath);
        }
        children.push(item);
      }
    }

    return {
      name: path.basename(dirPath),
      path: dirPath,
      type: 'folder',
      children,
    };
  } catch {
    return { name: path.basename(dirPath), path: dirPath, type: 'folder', children: [] };
  }
}

function watchWorkspace() {
  stopWatching(); // clear timers and queue before closing old watcher
  if (!workspacePath) return;

  // Resolve symlinks so path.relative matches chokidar's FSEvents paths (macOS)
  let realWsPath;
  try { realWsPath = fs.realpathSync(workspacePath); } catch { realWsPath = workspacePath; }

  watcher = chokidar.watch(workspacePath, {
    ignoreInitial: true,
    ignored: [
      /(^|[/\\])\./,           // dotfiles and dotfolders (.git, .claude, .DS_Store, etc.)
      '**/node_modules/**',
      '**/storage/**',          // note-internal storage (KV, SQLite, files — feature 128)
      '**/scripts/logs/**',     // script & frontend log files (avoid reload loops)
    ],
    persistent: true,
    depth: 20,
  });

  watcher.on('all', () => {
    clearTimeout(watchDebounceTimer);
    watchDebounceTimer = setTimeout(() => {
      mainWindow?.webContents.send("notes:updated", buildFileTree(workspacePath));
    }, 200);
  });

  watcher.on('all', () => {
    sync.notifyFileChange();
  });

  // SEARCH DISABLED — searchIncremental.start(watcher); // attach incremental index listeners
  // TAGS/BACKLINKS DISABLED
  // tagsIndex.start(watcher);
  // backlinksIndex.start(watcher); // attach backlinks index listeners (feature 126)
  templatesRegistry.start(watcher);
  builtInTemplates.start(watcher, path.join(workspacePath, TEMPLATES_DIR_NAME), _remoteManifest ? Object.keys(_remoteManifest) : []);

  // Per-file debounced AWS content sync (feature 146) + server sync (SSH/SFTP)
  // Filter by .syncignore rules instead of just .html
  const _syncIg = syncIgnore.loadIgnore(workspacePath);

  watcher.on('change', (absPath) => {
    if (!workspacePath) return;
    const relPath = path.relative(workspacePath, absPath).replace(/\\/g, '/');
    if (_syncIg.ignores(relPath)) return;
    syncManager.onContentSave(relPath);
    serverSyncManager.onContentSave(relPath);

    // Per-file debounced content-change notification for live webview reload
    clearTimeout(_contentChangeTimers.get(absPath));
    _contentChangeTimers.set(absPath, setTimeout(() => {
      _contentChangeTimers.delete(absPath);
      mainWindow?.webContents.send('note:contentChanged', absPath);
    }, 300));
  });

  watcher.on('add', (absPath) => {
    if (!workspacePath) return;
    const relPath = path.relative(workspacePath, absPath).replace(/\\/g, '/');
    if (_syncIg.ignores(relPath)) return;
    syncManager.onContentSave(relPath);
    serverSyncManager.onContentSave(relPath);
  });

  watcher.on('unlink', (absPath) => {
    if (!workspacePath) return;
    const relPath = path.relative(workspacePath, absPath).replace(/\\/g, '/');
    if (_syncIg.ignores(relPath)) return;
    syncManager.onContentDelete(relPath);
    serverSyncManager.onContentDelete(relPath);
  });

  // Feature 123: real-time stale-favorites cleanup on external file deletions
  let _pendingFavUnlinks = new Set();
  watcher.on('unlink', (absPath) => {
    if (!workspacePath) return;
    let realAbsPath;
    try {
      realAbsPath = path.join(fs.realpathSync(path.dirname(absPath)), path.basename(absPath));
    } catch {
      realAbsPath = absPath;
    }
    const relPath = path.relative(realWsPath, realAbsPath);
    if (!favorites.list().includes(relPath)) return; // fast exit if not a favorite
    _pendingFavUnlinks.add(relPath);
    clearTimeout(_favUnlinkTimer);
    _favUnlinkTimer = setTimeout(() => {
      const toRemove = [..._pendingFavUnlinks];
      _pendingFavUnlinks.clear();
      let changed = false;
      for (const p of toRemove) {
        const before = favorites.list();
        favorites.remove(workspacePath, p);
        if (favorites.list().length !== before.length) changed = true;
      }
      if (changed) {
        mainWindow?.webContents.send('favorites:changed', favorites.list());
      }
    }, 300);
  });

  // Feature 128: real-time stale-favorites cleanup on external note folder deletions
  watcher.on('unlinkDir', (absPath) => {
    if (!workspacePath) return;
    let realAbsPath;
    try {
      realAbsPath = path.join(fs.realpathSync(path.dirname(absPath)), path.basename(absPath));
    } catch {
      realAbsPath = absPath;
    }
    const relPath = path.relative(realWsPath, realAbsPath);
    if (!favorites.list().includes(relPath)) return; // fast exit if not a favorite
    _pendingFavUnlinks.add(relPath);
    clearTimeout(_favUnlinkTimer);
    _favUnlinkTimer = setTimeout(() => {
      const toRemove = [..._pendingFavUnlinks];
      _pendingFavUnlinks.clear();
      let changed = false;
      for (const p of toRemove) {
        const before = favorites.list();
        favorites.remove(workspacePath, p);
        if (favorites.list().length !== before.length) changed = true;
      }
      if (changed) {
        mainWindow?.webContents.send('favorites:changed', favorites.list());
      }
    }, 300);
  });

  // Forward templates registry changes to renderer (feature 112)
  templatesRegistry.on('registry-changed', () => {
    mainWindow?.webContents.send('templates:updated', templatesRegistry.getAll());
  });

  // TAGS/BACKLINKS DISABLED — Forward tags change events to renderer (feature 98 + 99)
  // let _pendingTagChanges = [];
  // let _pendingFullRefresh = false;
  //
  // const _scheduleTagsChanged = () => {
  //   clearTimeout(_tagsChangedTimer);
  //   _tagsChangedTimer = setTimeout(() => {
  //     if (_pendingFullRefresh) {
  //       mainWindow?.webContents.send('tags:changed', null); // null = full refresh
  //     } else {
  //       mainWindow?.webContents.send('tags:changed', [..._pendingTagChanges]);
  //     }
  //     _pendingTagChanges = [];
  //     _pendingFullRefresh = false;
  //   }, 100);
  // };
  //
  // tagsIndex.on('tags-changed', ({ filePath, newTags }) => {
  //   _pendingTagChanges.push({ filePath, newTags });
  //   _scheduleTagsChanged();
  // });
  // tagsIndex.on('build-complete', () => {
  //   _pendingFullRefresh = true;
  //   _scheduleTagsChanged();
  // });
  //
  // // Forward backlinks change events to renderer (feature 126)
  // let _pendingBacklinksPaths = new Set();
  // backlinksIndex.on('backlinks-changed', ({ affectedTargets }) => {
  //   if (!workspacePath || !mainWindow) return;
  //   for (const absPath of affectedTargets) {
  //     _pendingBacklinksPaths.add(absPath);
  //   }
  //   clearTimeout(_backlinksChangedTimer);
  //   _backlinksChangedTimer = setTimeout(() => {
  //     mainWindow?.webContents.send('backlinks:changed', [..._pendingBacklinksPaths]);
  //     _pendingBacklinksPaths = new Set();
  //   }, 100);
  // });
}

const { fetchText } = require('./providers/remote-models');

const CLAUDE_MD_MARKER_START = '<!-- APP-DEFAULT (do not edit — this section is auto-updated) -->';
const CLAUDE_MD_MARKER_END = '<!-- /APP-DEFAULT -->';
const { claudeMdUrl: CLAUDE_MD_REMOTE_URL } = require('./content-urls');

// TAGS/BACKLINKS/GRAPH DISABLED — GRAPH_LINK_SKILL_TEMPLATE
// const GRAPH_LINK_SKILL_TEMPLATE = `# Graph Link Skill
//
// When creating or editing a note, link it to related existing notes.
//
// ## Before writing a new note
//
// 1. Use the Glob tool to list all \`.html\` files in the workspace root.
// 2. Skim filenames for topically related notes.
// 3. Read the 1–3 most relevant files to confirm they are related.
//
// ## Inline links
//
// Within the note body, add \`<a href="filename.html">link text</a>\` wherever a
// natural reference to another note arises.
//
// ## Related Notes footer
//
// At the end of every note, inside \`<article>\` and after the main content, add:
//
// \`\`\`html
// <footer class="related-notes">
//   <h2>Related Notes</h2>
//   <ul>
//     <li><a href="related-note.html">Related Note Title</a></li>
//   </ul>
// </footer>
// \`\`\`
//
// - Omit the footer entirely if no related notes exist.
// - List only notes that are genuinely related — 1 to 5 links at most.
//
// ## Backlinks
//
// If you create a note that is strongly related to an existing note that already
// has a \`<footer class="related-notes">\` section, add a backlink in that
// existing note pointing to the new note.
// `;

// TAGS DISABLED — buildTagsHint()
// /**
//  * Build a concise tags hint block to prepend to every Claude prompt.
//  * Reads from the in-memory tags index — no I/O.
//  * Returns a one- or two-line string describing available tags.
//  *
//  * If the index is not ready or empty, returns a "no tags yet" hint so
//  * Claude still generates sensible tags for new notes.
//  * If the index has more than 30 tags, sends only the top 30 by usage count.
//  */
// function buildTagsHint() {
//   let allTags;
//   try {
//     allTags = tagsIndex.getAllTags(); // [{ tag, count }] sorted alphabetically
//   } catch {
//     return '[No tags exist in this workspace yet. When creating notes, add sensible tags based on the content.]';
//   }
//   if (!allTags || allTags.length === 0) {
//     return '[No tags exist in this workspace yet. When creating notes, add sensible tags based on the content.]';
//   }
//   const sorted = [...allTags].sort((a, b) => b.count - a.count);
//   const top = sorted.slice(0, 30);
//   const tagList = top.map(t => t.tag).join(', ');
//   const suffix = allTags.length > 30 ? ` (showing top 30 of ${allTags.length})` : '';
//   return `[Available tags in this workspace: ${tagList}]${suffix}\n(Reuse existing tags when applicable. Create new tags only when no existing tag fits.)`;
// }

// GRAPH DISABLED — buildGraphLinkHint()
// /**
//  * Read .claude/graph-link-skill.md from the current workspace and return its
//  * content wrapped in delimiters, ready to be prepended to the Claude prompt.
//  * Returns an empty string if the file does not exist or is empty.
//  * Reads from disk each time so the user can edit the file without restarting.
//  */
// function buildGraphLinkHint(wsPath) {
//   if (!wsPath) return '';
//   const skillPath = path.join(wsPath, '.claude', 'graph-link-skill.md');
//   try {
//     const content = fs.readFileSync(skillPath, 'utf8').trim();
//     if (!content) return '';
//     return '[Graph Link Skill]\n' + content + '\n[/Graph Link Skill]';
//   } catch {
//     return '';
//   }
// }

/**
 * Provider instruction file descriptors.
 * Each entry defines where a provider's native instruction file lives,
 * relative to the workspace root. All files share the same marker-based
 * APP-DEFAULT / Custom Instructions structure, but users can customise
 * each one independently.
 */
const PROVIDER_INSTRUCTION_FILES = [
  { provider: 'claude',  relPath: path.join('.claude', 'CLAUDE.md') },
  { provider: 'codex',   relPath: 'AGENTS.md' },
  { provider: 'gemini',  relPath: path.join('.gemini', 'GEMINI.md') },
];

/**
 * Ensure a single provider instruction file exists and update its
 * APP-DEFAULT section with the given remote content.
 *
 * - If the file doesn't exist, create it with default + custom template.
 * - If it exists but has no markers, prepend default section, keep existing
 *   content as custom.
 * - If it has markers, replace only the content between them.
 *
 * @param {string} filePath  Absolute path to the instruction file
 * @param {string|null} remoteContent  Latest default content from remote (null to skip update)
 */
function ensureAndSyncInstructionFile(filePath, remoteContent) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let existing = null;
  try { existing = fs.readFileSync(filePath, 'utf8'); } catch {}

  if (existing === null) {
    // File doesn't exist — create with initial template
    const defaultBody = remoteContent ? remoteContent.trim() : '';
    const content = CLAUDE_MD_MARKER_START + '\n' + defaultBody + '\n'
      + CLAUDE_MD_MARKER_END + '\n\n## Custom Instructions\n\nAdd your own instructions below.\n';
    fs.writeFileSync(filePath, content);
    return;
  }

  // File exists — update APP-DEFAULT section if we have remote content
  if (!remoteContent) return;

  const startIdx = existing.indexOf(CLAUDE_MD_MARKER_START);
  const endIdx = existing.indexOf(CLAUDE_MD_MARKER_END);

  let updated;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Markers found — replace content between them
    updated = existing.slice(0, startIdx + CLAUDE_MD_MARKER_START.length)
      + '\n' + remoteContent.trim() + '\n'
      + existing.slice(endIdx);
  } else {
    // Markers missing — prepend default section, keep existing content as custom
    updated = CLAUDE_MD_MARKER_START + '\n' + remoteContent.trim() + '\n'
      + CLAUDE_MD_MARKER_END + '\n\n' + existing;
  }

  fs.writeFileSync(filePath, updated);
}

/**
 * Fetch remote default content once, then ensure and sync all provider
 * instruction files in parallel.
 */
async function syncAllProviderInstructions(dirPath) {
  const remoteContent = await fetchText(CLAUDE_MD_REMOTE_URL).catch(() => null);

  for (const desc of PROVIDER_INSTRUCTION_FILES) {
    const filePath = path.join(dirPath, desc.relPath);
    ensureAndSyncInstructionFile(filePath, remoteContent);
  }
}

/**
 * Sync component templates from the downloaded tarball into the workspace.
 * Copies the full component-templates/ tree into {workspace}/.component-templates/.
 * Overwrites existing files to keep templates up-to-date.
 */
function syncComponentTemplates(wsPath, sourceDir) {
  const destDir = path.join(wsPath, '.component-templates');
  try {
    const entries = fs.readdirSync(sourceDir);
    for (const entry of entries) {
      const srcPath = path.join(sourceDir, entry);
      const destPath = path.join(destDir, entry);
      if (fs.statSync(srcPath).isDirectory()) {
        _copyDirRecursive(srcPath, destPath);
      }
    }
  } catch (err) {
    console.warn('[component-templates] sync failed:', err.message);
  }
}

function _copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      _copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Ensure AGENTS.md and .gemini/ are in .gitignore so provider-specific
 * instruction files are not committed (CLAUDE.md is already in .claude/).
 */
async function ensureProviderFilesGitignore(wsPath) {
  if (!fs.existsSync(path.join(wsPath, '.git'))) return;
  const gitignorePath = path.join(wsPath, '.gitignore');
  let content;
  try {
    content = await fs.promises.readFile(gitignorePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  const entries = ['AGENTS.md', '.gemini/', '.component-templates/'];
  const toAdd = entries.filter(e => !content.includes(e));
  if (toAdd.length === 0) return;
  const suffix = content.endsWith('\n') || !content ? '' : '\n';
  fs.writeFileSync(gitignorePath, content + suffix + '# auto-synced files\n' + toAdd.join('\n') + '\n');
}

async function ensureNotesAppGitignore(wsPath) {
  const gitignorePath = path.join(wsPath, '.gitignore');
  let content;
  try {
    content = await fs.promises.readFile(gitignorePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  const lines = content.split('\n').map(l => l.trim());
  if (lines.some(l => l === '.notes-app/' || l === '.notes-app')) return;
  await fs.promises.appendFile(gitignorePath, '\n# AWS sync state\n.notes-app/\n', 'utf8');
}

function bootstrapWorkspace(dirPath) {
  const claudeDir = path.join(dirPath, ".claude");
  // GRAPH DISABLED — graph-link-skill.md bootstrapping
  // const graphLinkSkillPath = path.join(claudeDir, "graph-link-skill.md");
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  // if (!fs.existsSync(graphLinkSkillPath)) {
  //   fs.writeFileSync(graphLinkSkillPath, GRAPH_LINK_SKILL_TEMPLATE);
  // }
  // Ensure all provider instruction files exist and sync from remote
  syncAllProviderInstructions(dirPath).catch(() => {});
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const MIME_TYPES = {
    // web documents
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.xml': 'application/xml',
    // fonts
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    // media
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.pdf': 'application/pdf',
    // images
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif',
  };
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function isInsideWorkspace(targetPath) {
  if (!workspacePath) return false;
  const resolved = path.resolve(targetPath);
  const wsResolved = path.resolve(workspacePath);
  return resolved.startsWith(wsResolved + path.sep) || resolved === wsResolved;
}

// --- IPC handlers ---

// Synchronous handler: preload uses sendSync to get the note-preload.js file URL.
// This avoids requiring Node built-ins (path, url) in the sandboxed preload script.
ipcMain.on('get-note-preload-url', (event) => {
  const { pathToFileURL } = require('url');
  event.returnValue = pathToFileURL(path.join(__dirname, 'note-preload.js')).href;
});

ipcMain.on('get-note-css', (event) => {
  event.returnValue = NOTE_CSS;
});

ipcMain.handle('window:close', () => {
  mainWindow.close();
});

// Terminal
ipcMain.handle('terminal:toggle', () => {
  if (!mainWindow) return false;
  return terminalManager.toggleTerminalWindow(mainWindow, workspacePath);
});
ipcMain.handle('terminal:isVisible', () => terminalManager.isTerminalVisible());

ipcMain.handle('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.handle('shell:openExternal', (_event, url) => {
  if (typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) return;
  shell.openExternal(url);
});

// Fallback: open workspace folder in Finder
ipcMain.handle("workspace:openInFinder", () => {
  if (workspacePath) {
    shell.openPath(workspacePath);
  }
});

ipcMain.handle("workspace:list", () => buildFileTree(workspacePath));

ipcMain.handle("workspace:read", (_e, filePath) => {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
});

ipcMain.handle("workspace:readBinary", (_e, filePath) => {
  if (!workspacePath || !filePath.startsWith(workspacePath + path.sep)) {
    return null;
  }
  try {
    const data = fs.readFileSync(filePath);
    return { data: data.toString('base64'), mimeType: getMimeType(filePath) };
  } catch {
    return null;
  }
});

ipcMain.handle("workspace:path", () => workspacePath);

ipcMain.handle("fs:saveTempImage", (_e, filename, base64Data) => {
  if (!workspacePath) return { success: false };
  if (!filename || /[/\\]/.test(filename)) return { success: false };

  const tempDir = path.join(workspacePath, ".claude-temp");
  try {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const fullPath = path.join(tempDir, filename);
    fs.writeFileSync(fullPath, Buffer.from(base64Data, "base64"));
    return { success: true, tempPath: fullPath };
  } catch {
    return { success: false };
  }
});

ipcMain.handle("fs:cleanupTempImages", () => {
  if (!workspacePath) return;
  const tempDir = path.join(workspacePath, ".claude-temp");
  try {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(tempDir, file));
      } catch {
        // Skip files that can't be deleted
      }
    }
  } catch {
    // tempDir may not exist — that's fine
  }
});

// --- File operations ---

ipcMain.handle("fs:rename", async (_e, oldPath, newPath) => {
  try {
    if (!isInsideWorkspace(oldPath) || !isInsideWorkspace(newPath)) {
      return { success: false, error: "Path is outside workspace" };
    }
    await fs.promises.rename(oldPath, newPath);
    // Update favorites if the renamed file was a favorite (feature 123)
    if (workspacePath) {
      const oldRelPath = path.relative(workspacePath, oldPath);
      const newRelPath = path.relative(workspacePath, newPath);
      const before = favorites.list();
      const updated = favorites.rename(workspacePath, oldRelPath, newRelPath);
      if (before.includes(oldRelPath)) {
        mainWindow?.webContents.send('favorites:changed', updated);
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("fs:trash", async (_e, itemPath) => {
  try {
    if (!isInsideWorkspace(itemPath)) {
      return { success: false, error: "Path is outside workspace" };
    }
    await shell.trashItem(itemPath);
    // Remove from favorites if the trashed file was a favorite (feature 123)
    if (workspacePath) {
      const relPath = path.relative(workspacePath, itemPath);
      const before = favorites.list();
      const updated = favorites.remove(workspacePath, relPath);
      if (updated.length !== before.length) {
        mainWindow?.webContents.send('favorites:changed', updated);
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("fs:createFile", async (_e, filePath) => {
  try {
    if (!isInsideWorkspace(filePath)) {
      return { success: false, error: "Path is outside workspace" };
    }
    await fs.promises.writeFile(filePath, "", { flag: "wx" });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("fs:createFileWithContent", async (_e, filePath, content) => {
  try {
    if (!isInsideWorkspace(filePath)) {
      return { success: false, error: "Path is outside workspace" };
    }
    await fs.promises.writeFile(filePath, content, { flag: "wx" });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("fs:createFolder", async (_e, dirPath) => {
  try {
    if (!isInsideWorkspace(dirPath)) {
      return { success: false, error: "Path is outside workspace" };
    }
    await fs.promises.mkdir(dirPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// --- Note folder operations (feature 128) ---

ipcMain.handle('fs:createNote', async (_e, folderPath, content) => {
  if (!workspacePath) throw new Error('No workspace open');
  const resolved = path.resolve(folderPath);
  if (!resolved.startsWith(workspacePath + path.sep)) {
    throw new Error('Invalid path (outside workspace)');
  }
  await fs.promises.mkdir(resolved, { recursive: true });
  const indexPath = path.join(resolved, 'index.html');
  await fs.promises.writeFile(indexPath, content || '', { flag: 'wx' });
  return { success: true };
});

ipcMain.handle('fs:createNoteFromTemplate', async (_e, destPath, templatePath) => {
  if (!workspacePath) throw new Error('No workspace open');
  const resolvedDest = path.resolve(destPath);
  const resolvedTpl = path.resolve(templatePath);
  if (!resolvedDest.startsWith(workspacePath + path.sep)) {
    throw new Error('Invalid path (outside workspace)');
  }
  if (fs.existsSync(resolvedDest)) {
    throw new Error('Destination already exists');
  }
  fs.cpSync(resolvedTpl, resolvedDest, { recursive: true });
  return { success: true };
});

ipcMain.handle('fs:pathExists', async (_e, filePath) => {
  if (!workspacePath) return false;
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(workspacePath + path.sep)) return false;
  return fs.existsSync(resolved);
});

ipcMain.handle('fs:duplicateNote', async (_e, folderPath) => {
  if (!workspacePath) throw new Error('No workspace open');
  const resolved = path.resolve(folderPath);
  if (!resolved.startsWith(workspacePath + path.sep)) {
    throw new Error('Invalid path (outside workspace)');
  }
  if (!fs.existsSync(resolved)) throw new Error('Source folder does not exist');

  const parent = path.dirname(resolved);
  const base = path.basename(resolved);

  // Find a non-conflicting name: `{name}-copy`, `{name}-copy-2`, etc.
  let destName = base + '-copy';
  let dest = path.join(parent, destName);
  let counter = 2;
  while (fs.existsSync(dest)) {
    destName = base + '-copy-' + counter++;
    dest = path.join(parent, destName);
  }

  fs.cpSync(resolved, dest, { recursive: true });
  return { success: true, newPath: dest };
});

// --- Project create / open ---

ipcMain.handle("project:create", async (_e, { dirPath, projectName, initClaude, initGit: doGit }) => {
  const fullPath = path.join(dirPath, projectName);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
  if (initClaude) bootstrapWorkspace(fullPath);
  if (doGit && !hasGit(fullPath)) initGit(fullPath);

  await openWorkspace(fullPath);
  return fullPath;
});

ipcMain.handle("project:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open an existing project folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const dirPath = result.filePaths[0];
  // Return status so renderer can show init prompt if needed
  return {
    path: dirPath,
    hasClaude: hasClaude(dirPath),
    hasGit: hasGit(dirPath),
  };
});

ipcMain.handle("project:confirmOpen", async (_e, { dirPath, initClaude, initGit: doGit }) => {
  if (initClaude && !hasClaude(dirPath)) bootstrapWorkspace(dirPath);
  if (doGit && !hasGit(dirPath)) initGit(dirPath);

  await openWorkspace(dirPath);
  return true;
});

ipcMain.handle("project:changeWorkspace", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Switch workspace folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const dirPath = result.filePaths[0];
  bootstrapWorkspace(dirPath);
  await openWorkspace(dirPath);
  return dirPath;
});

ipcMain.handle("project:browseDirectory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose project location",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('project:clone', async (_e, { remoteUrl, targetPath }) => {
  const result = await sync.cloneRepo(remoteUrl, targetPath);
  if (!result.ok) return result;

  // Bootstrap Claude project if not present (cloned repo may or may not have .claude/)
  if (!hasClaude(targetPath)) bootstrapWorkspace(targetPath);

  // Open the workspace — starts commit engine, push/pull engine, and auto-sync automatically
  await openWorkspace(targetPath);
  return { ok: true, path: targetPath };
});

ipcMain.handle('project:checkTargetDir', (_e, targetPath) => {
  return sync.checkTargetDirectory(targetPath);
});

ipcMain.handle("dialog:browseFiles", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths.map((filePath) => {
    let size = 0;
    try {
      size = fs.statSync(filePath).size;
    } catch {}
    return {
      filePath,
      filename: path.basename(filePath),
      size,
      mimeType: getMimeType(filePath),
    };
  });
});

ipcMain.handle("fs:readFilePreview", (_e, filePath) => {
  const mimeType = getMimeType(filePath);
  if (!mimeType.startsWith("image/")) return null;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 10 * 1024 * 1024) return null;
    const data = fs.readFileSync(filePath).toString("base64");
    return { data, mimeType };
  } catch {
    return null;
  }
});

ipcMain.handle("project:defaultDir", () => {
  const docs = path.join(os.homedir(), "Documents");
  if (fs.existsSync(docs)) return docs;
  return os.homedir();
});

ipcMain.handle("claude:send", (_e, prompt, messages) => {
  if (!workspacePath) return;
  if (claudeProc) activeProvider().cancel();

  // Start a new session if none exists
  const isResume = currentSessionId !== null && messageCount > 0;
  const isNew = !currentSessionId;
  if (!currentSessionId) {
    currentSessionId = generateSessionId();
  }
  messageCount++;
  if (isNew) {
    mainWindow?.webContents.send('claude:sessionId', currentSessionId);
  }

  if (process.env.TEST_MODE === '1') {
    _lastClaudePrompt = prompt;
  }

  claudeProc = activeProvider().send(prompt, {
    cwd: workspacePath,
    sessionId: currentSessionId,
    isResume,
    messageCount,
    model: getActiveModel(),
    effort: getActiveEffort(),
    permissionMode: getActivePermissionMode(),
    unsetApiKeys: prefs.getUnsetApiKeys(),
    messages: messages || null,
    onEvent(event) {
      mainWindow?.webContents.send("claude:event", event);
    },
    onError(chunk) {
      mainWindow?.webContents.send("claude:error", chunk);
    },
    onDone(code) {
      claudeProc = null;
      sync.setClaudeBusy(false);
      mainWindow?.webContents.send("claude:done", code);
      // Force sidebar refresh after provider completes, in case the
      // file watcher missed events (e.g. remote/WebSocket providers).
      if (workspacePath) {
        mainWindow?.webContents.send("notes:updated", buildFileTree(workspacePath));
      }
    },
  });
  sync.setClaudeBusy(true);
});

ipcMain.handle("claude:cancel", () => {
  if (claudeProc) {
    activeProvider().cancel();
    claudeProc = null;
    sync.setClaudeBusy(false);
  }
});

// Feature 128: OpenAI-compatible HTTP endpoints
ipcMain.handle('openai-compat:getEndpoints', () => {
  return prefs.getOpenaiCompatEndpoints();
});

function applyUserModifiedFlag(endpoints, allPresets) {
  return endpoints.map(endpoint => {
    if (!endpoint.presetId) return endpoint; // custom endpoint, no tracking
    const preset = allPresets.find(p => p.id === endpoint.presetId);
    if (!preset) return endpoint; // preset removed from remote
    const modified =
      endpoint.baseUrl !== preset.baseUrl ||
      endpoint.modelId !== (preset.defaultModel || '');
    return { ...endpoint, userModified: modified };
  });
}

ipcMain.handle('openai-compat:setEndpoints', async (_e, endpoints) => {
  await _presetsReady;
  // Endpoints must include an `id` field (UUID). Generated by the caller (e.g. settings UI).
  const withFlags = applyUserModifiedFlag(endpoints, _allPresets);
  prefs.setOpenaiCompatEndpoints(withFlags);
  registerOpenAICompatEndpoints(withFlags);
  mainWindow?.webContents.send('providers:updated');
});

ipcMain.handle('openai-compat:fetchModels', async (_e, baseUrl, apiKey) => {
  const { fetchModels } = require('./providers/openai-compat-bridge');
  return fetchModels({ baseUrl, apiKey });
});

// Feature 129: Preset support
ipcMain.handle('openai-compat:getAvailablePresets', async () => {
  await _presetsReady;
  return _availablePresets;
});

ipcMain.handle('openai-compat:getPresets', async () => {
  await _presetsReady;
  return _allPresets;
});

ipcMain.handle('openai-compat:resetEndpoint', async (_e, endpointId) => {
  await _presetsReady;
  const saved = prefs.getOpenaiCompatEndpoints();
  const idx = saved.findIndex(e => e.id === endpointId);
  if (idx === -1) return; // endpoint not found, nothing to do

  const reset = resetEndpointToPreset(saved[idx], _allPresets);
  saved[idx] = reset;
  prefs.setOpenaiCompatEndpoints(saved);
  registerOpenAICompatEndpoints(saved);
  mainWindow?.webContents.send('providers:updated');
  return reset;
});

// Feature 150: OpenClaw remote endpoints
ipcMain.handle('openclaw-remote:getEndpoints', () => {
  return prefs.getOpenclawRemoteEndpoints();
});

ipcMain.handle('openclaw-remote:setEndpoints', (_e, endpoints) => {
  const auth = require('./providers/openclaw-remote-auth');
  const cleaned = endpoints.map(ep => {
    // Encrypt gateway token if present, strip from persisted config
    if (ep.token && ep.id) {
      auth.writeRemoteGatewayToken(ep.id, ep.token);
    }
    // Always ensure device identity exists
    if (ep.id) {
      let identity = auth.readRemoteDeviceIdentity(ep.id);
      if (!identity) {
        identity = auth.generateDeviceIdentity();
        auth.writeRemoteDeviceIdentity(ep.id, identity);
      }
    }
    const { token, ...rest } = ep;
    return rest;
  });
  prefs.setOpenclawRemoteEndpoints(cleaned);
  registerOpenClawRemoteEndpoints(cleaned);
  mainWindow?.webContents.send('providers:updated');
});

// Feature 151: OpenClaw Remote Setup UI — granular IPC handlers
ipcMain.handle('openclaw-remote:add', async (_e, endpoint) => {
  const { randomUUID } = require('crypto');
  const auth = require('./providers/openclaw-remote-auth');

  // Assign an ID if renderer did not supply one
  const id = endpoint.id || randomUUID();
  const newEndpoint = { ...endpoint, id };

  // Encrypt and store gateway token separately if provided
  if (newEndpoint.token) {
    auth.writeRemoteGatewayToken(id, newEndpoint.token);
  }
  delete newEndpoint.token; // never persist token in preferences

  // Always generate device identity
  let identity = auth.readRemoteDeviceIdentity(id);
  if (!identity) {
    identity = auth.generateDeviceIdentity();
    auth.writeRemoteDeviceIdentity(id, identity);
  }

  const endpoints = prefs.getOpenclawRemoteEndpoints();
  endpoints.push(newEndpoint);
  prefs.setOpenclawRemoteEndpoints(endpoints);
  registerOpenClawRemoteEndpoints(endpoints);
  mainWindow?.webContents.send('providers:updated');
  return newEndpoint; // return so renderer gets the assigned ID
});

ipcMain.handle('openclaw-remote:remove', async (_e, endpointId) => {
  try {
    const auth = require('./providers/openclaw-remote-auth');
    const current = prefs.getOpenclawRemoteEndpoints();
    const endpoints = current.filter(e => e.id !== endpointId);
    if (endpoints.length === current.length) {
      return { ok: false, error: 'Endpoint not found' };
    }
    prefs.setOpenclawRemoteEndpoints(endpoints);
    auth.deleteRemoteCredentials(endpointId);
    registerOpenClawRemoteEndpoints(endpoints);
    mainWindow?.webContents.send('providers:updated');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('openclaw-remote:test', async (_e, endpoint) => {
  const { OpenClawBridge } = require('./providers/openclaw-bridge');
  const auth = require('./providers/openclaw-remote-auth');

  // Build auth config: always device auth + optional gateway token
  let identity = endpoint.id ? auth.readRemoteDeviceIdentity(endpoint.id) : null;
  if (!identity) {
    identity = auth.generateDeviceIdentity();
    if (endpoint.id) auth.writeRemoteDeviceIdentity(endpoint.id, identity);
  }
  const deviceToken = endpoint.id ? auth.readRemoteDeviceToken(endpoint.id) : null;
  const pairedMeta = auth.readRemotePairedMetadata(endpoint.id);
  // Use token from UI if provided (pre-save test), otherwise read encrypted store
  const gatewayToken = endpoint.token || (endpoint.id ? auth.readRemoteGatewayToken(endpoint.id) : null) || undefined;
  const authConfig = { deviceIdentity: identity, deviceToken, pairedMeta, gatewayToken };

  const bridge = new OpenClawBridge();
  const t0 = Date.now();
  try {
    await bridge.connectWithMode(endpoint.url, authConfig);
    const result = await bridge.sendRequest('models.list', {});
    const latencyMs = Date.now() - t0;
    const list = Array.isArray(result)
      ? result
      : (Array.isArray(result?.models) ? result.models : []);
    return { ok: true, models: list, latencyMs };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try { bridge.disconnect(); } catch {}
  }
});

// Feature 100: test-only handler — exposes last augmented prompt for test assertions
// Only registered when TEST_MODE=1 to avoid exposing internals in production.
if (process.env.TEST_MODE === '1') {
  ipcMain.handle('claude:getLastPrompt', () => _lastClaudePrompt);
}

ipcMain.handle("claude:newConversation", () => {
  if (claudeProc) {
    activeProvider().reset();
    claudeProc = null;
    sync.setClaudeBusy(false);
  }
  currentSessionId = null;
  messageCount = 0;
});

ipcMain.handle('providers:list', () => {
  return listProviders();
});

ipcMain.handle('providers:setActive', (_e, name) => {
  setActiveProvider(name);
});

ipcMain.handle('conversations:list', () => {
  if (!workspacePath) return [];
  return conversations.list(workspacePath);
});

ipcMain.handle('conversations:load', (_e, id) => {
  if (!workspacePath) return null;
  return conversations.load(workspacePath, id);
});

ipcMain.handle('conversations:save', (_e, conv) => {
  if (!workspacePath) return;
  conversations.save(workspacePath, conv);
});

ipcMain.handle('conversations:delete', (_e, id) => {
  if (!workspacePath) return;
  conversations.remove(workspacePath, id);
});

ipcMain.handle('conversations:updateTitle', (_e, id, newTitle) => {
  if (!workspacePath) return;
  conversations.updateTitle(workspacePath, id, newTitle);
});

// Context snapshot — shared .context/ folder for external tools
ipcMain.handle('context:updateQuotes', (_e, items) => {
  if (!workspacePath) return;
  contextSnapshot.writeQuotes(workspacePath, items);
});

ipcMain.handle('context:updateCurrentNote', (_e, noteInfo) => {
  if (!workspacePath) return;
  contextSnapshot.writeCurrentNote(workspacePath, noteInfo);
});

ipcMain.handle('claude:resumeConversation', (_e, sessionId, msgCount) => {
  if (claudeProc) {
    activeProvider().cancel();
    claudeProc = null;
  }
  currentSessionId = sessionId || null;
  messageCount = msgCount || 0;
});

ipcMain.handle("sync:getStatus", async () => {
  if (!workspacePath) return null;
  return sync.getGitStatus(workspacePath);
});

ipcMain.handle('sync:getState', () => sync.getState());

ipcMain.handle('sync:tryTransition', (_event, nextState) => {
  try {
    sync.transition(nextState);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('sync:ensureGitignore', async () => {
  if (!workspacePath) return null;
  return sync.ensureGitignore(workspacePath);
});

ipcMain.handle('sync:checkAuth', async (_event, remoteUrl) => {
  let url = remoteUrl;
  if (!url) {
    if (!workspacePath) {
      return { ok: false, errorType: 'no-remote', guidance: { title: 'No remote configured', message: 'Please provide a repository URL.', steps: [] } };
    }
    const status = await sync.getGitStatus(workspacePath);
    if (!status.hasRemote || !status.remoteUrl) {
      return { ok: false, errorType: 'no-remote', guidance: { title: 'No remote configured', message: 'No git remote is configured for this workspace.', steps: [] } };
    }
    url = status.remoteUrl;
  }
  // Use workspacePath as cwd if available; fall back to os.tmpdir() for pre-clone auth checks.
  // git ls-remote does not need a specific working directory.
  const wsForAuth = workspacePath || require('os').tmpdir();
  return sync.checkAuth(wsForAuth, url);
});

ipcMain.handle('sync:initRepo', async () => {
  if (!workspacePath) return { ok: false, error: 'No workspace open' };
  if (hasGit(workspacePath)) return { ok: true, alreadyRepo: true };
  try {
    initGit(workspacePath);
    return { ok: true, alreadyRepo: false };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sync:addRemote', async (_event, url) => {
  if (!workspacePath) return { ok: false, error: 'No workspace open' };
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(url)) {
    return { ok: false, error: 'Invalid remote URL format' };
  }
  const bin = sync.findGitBin();
  try {
    let originExists = false;
    try {
      await execFileAsync(bin, ['remote', 'get-url', 'origin'], { cwd: workspacePath });
      originExists = true;
    } catch { /* no origin configured */ }
    if (originExists) {
      await execFileAsync(bin, ['remote', 'set-url', 'origin', url], { cwd: workspacePath });
    } else {
      await execFileAsync(bin, ['remote', 'add', 'origin', url], { cwd: workspacePath });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.stderr || err.message };
  }
});

ipcMain.handle('sync:pauseSync', async () => {
  if (!workspacePath) return { ok: false, error: 'No workspace open' };
  await sync.pauseSync(workspacePath);
  return { ok: true };
});

ipcMain.handle('sync:resumeSync', async () => {
  if (!workspacePath) return { ok: false, error: 'No workspace open' };
  await sync.resumeSync(workspacePath);
  return { ok: true };
});

ipcMain.handle('sync:disconnectSync', async () => {
  if (!workspacePath) return { ok: false, error: 'No workspace open' };
  await sync.disconnectSync(workspacePath);
  return { ok: true };
});

ipcMain.handle('sync:isPaused', () => {
  return sync.isSyncPaused();
});

ipcMain.handle('sync:getSyncSettings', async () => {
  if (!workspacePath) return sync.SYNC_SETTINGS_DEFAULTS;
  return await sync.readAllSyncSettings(workspacePath);
});

ipcMain.handle('sync:setSyncSettings', async (_event, rawSettings) => {
  if (!workspacePath) return { ok: false, error: 'no workspace open' };
  // Server-side validation: clamp ranges, coerce booleans
  const settings = {
    commitDebounceSeconds: Math.min(300, Math.max(10, Math.round(Number(rawSettings.commitDebounceSeconds) || 30))),
    pushIntervalSeconds:   Math.min(1800, Math.max(60, Math.round(Number(rawSettings.pushIntervalSeconds) || 300))),
    syncOnFocus:           rawSettings.syncOnFocus !== false,
    pauseDuringClaude:     rawSettings.pauseDuringClaude !== false,
  };
  await sync.writeSyncSettings(workspacePath, settings);
  return { ok: true };
});

// ─── Note Security Settings IPC ──────────────────────────────────────────────
ipcMain.handle('security:getSettings', () => {
  return { ...SECURITY_DEFAULTS, ..._securitySettings };
});

ipcMain.handle('security:setSettings', (_event, incoming) => {
  if (!workspacePath) return { ok: false, error: 'No workspace open' };
  const settings = {};
  for (const key of Object.keys(SECURITY_DEFAULTS)) {
    settings[key] = typeof incoming[key] === 'boolean' ? incoming[key] : SECURITY_DEFAULTS[key];
  }
  writeSecuritySettings(settings);
  return { ok: true };
});

ipcMain.handle('sync:initialCommitAndPush', async () => {
  if (!workspacePath) return { ok: false, error: 'No workspace open', step: 'setup' };
  return sync.enqueue(async () => {
    const bin = sync.findGitBin();

    try {
      await sync.ensureGitignore(workspacePath);
    } catch (err) {
      return { ok: false, error: err.message, step: 'gitignore' };
    }

    try {
      await execFileAsync(bin, ['add', '.'], { cwd: workspacePath });
    } catch (err) {
      return { ok: false, error: err.stderr || err.message, step: 'add' };
    }

    try {
      await execFileAsync(bin, ['commit', '-m', 'Initial sync from toutkit'],
        { cwd: workspacePath, env: { ...process.env, GIT_AUTHOR_NAME: 'toutkit', GIT_AUTHOR_EMAIL: 'app@toutkit', GIT_COMMITTER_NAME: 'toutkit', GIT_COMMITTER_EMAIL: 'app@toutkit' } });
    } catch (err) {
      const output = (err.stderr || '') + (err.stdout || '');
      if (!output.includes('nothing to commit')) {
        return { ok: false, error: err.stderr || err.message, step: 'commit' };
      }
      // "nothing to commit" is acceptable — proceed to push
    }

    const gitStatus = await sync.getGitStatus(workspacePath);
    const branch = gitStatus.branch || 'main';
    try {
      await execFileAsync(bin, ['push', '-u', 'origin', branch], { cwd: workspacePath });
    } catch (err) {
      return { ok: false, error: err.stderr || err.message, step: 'push' };
    }

    return { ok: true };
  });
});

ipcMain.handle('sync:reinitialize', async () => {
  if (!workspacePath) return null;
  const gitStatus = await sync.getGitStatus(workspacePath);
  sync.initSyncState(gitStatus);
  if (gitStatus.isRepo && gitStatus.hasRemote && gitStatus.branch) {
    sync.startPushPullEngine(workspacePath, gitStatus.branch);
    sync.startAutoSync();
  } else {
    sync.stopAutoSync();
    sync.stopPushPullEngine();
  }
  return gitStatus;
});

ipcMain.handle('sync:pullNow', async () => {
  return sync.pullNow();
});

ipcMain.handle('sync:pushNow', async () => {
  return sync.pushNow();
});

ipcMain.handle('sync:getLastSyncTimestamps', () => {
  return sync.getLastSyncTimestamps();
});

ipcMain.handle('sync:syncNow', async () => {
  return sync.syncNow();
});

ipcMain.handle('sync:getConflicts', () => sync.getConflicts());

ipcMain.handle('sync:resolveConflict', async (_event, filePath, chosenContent) => {
  const result = await sync.resolveConflict(filePath, chosenContent);
  if (result.ok && result.remaining === 0) {
    return sync.finalizeMerge();
  }
  return result;
});

ipcMain.handle('sync:finalizeMerge', async () => {
  return sync.finalizeMerge();
});

ipcMain.handle('sync:abortMerge', async () => {
  return sync.abortMerge();
});

ipcMain.handle('sync:getActivityLog', () => sync.getActivityLog());

ipcMain.handle('sync:checkHealth', async () => {
  if (!workspacePath) return { healthy: true, issues: [] };
  return sync.checkRepoHealth(workspacePath);
});

ipcMain.handle('sync:recoverLockedIndex', async () => {
  if (!workspacePath) return { ok: false, error: 'No workspace open' };
  const result = await sync.recoverLockedIndex(workspacePath);
  if (!result.ok) return result;
  const healthReport = await sync.checkRepoHealth(workspacePath);
  if (healthReport.healthy) {
    const gitStatus = await sync.getGitStatus(workspacePath);
    sync.initSyncState(gitStatus);
    if (gitStatus.isRepo) sync.startCommitEngine(workspacePath);
    if (gitStatus.isRepo && gitStatus.hasRemote && gitStatus.branch) {
      sync.startPushPullEngine(workspacePath, gitStatus.branch);
      sync.startAutoSync();
    }
  }
  return { ok: true, healthReport };
});

ipcMain.handle('sync:recoverInterruptedRebase', async () => {
  if (!workspacePath) return { ok: false, error: 'No workspace open' };
  const result = await sync.recoverInterruptedRebase(workspacePath);
  if (!result.ok) return result;
  const healthReport = await sync.checkRepoHealth(workspacePath);
  if (healthReport.healthy) {
    const gitStatus = await sync.getGitStatus(workspacePath);
    sync.initSyncState(gitStatus);
    if (gitStatus.isRepo) sync.startCommitEngine(workspacePath);
    if (gitStatus.isRepo && gitStatus.hasRemote && gitStatus.branch) {
      sync.startPushPullEngine(workspacePath, gitStatus.branch);
      sync.startAutoSync();
    }
  }
  return { ok: true, healthReport };
});

ipcMain.handle('sync:recoverInterruptedMerge', async () => {
  if (!workspacePath) return { ok: false, error: 'No workspace open' };
  const result = await sync.recoverInterruptedMerge(workspacePath);
  if (!result.ok) return result;
  const healthReport = await sync.checkRepoHealth(workspacePath);
  if (healthReport.healthy) {
    const gitStatus = await sync.getGitStatus(workspacePath);
    sync.initSyncState(gitStatus);
    if (gitStatus.isRepo) sync.startCommitEngine(workspacePath);
    if (gitStatus.isRepo && gitStatus.hasRemote && gitStatus.branch) {
      sync.startPushPullEngine(workspacePath, gitStatus.branch);
      sync.startAutoSync();
    }
  }
  return { ok: true, healthReport };
});

ipcMain.handle('sync:recoverDetachedHead', async (_event, targetBranch) => {
  if (!workspacePath) return { ok: false, error: 'No workspace open' };
  const result = await sync.recoverDetachedHead(workspacePath, targetBranch);
  if (!result.ok) return result;
  const healthReport = await sync.checkRepoHealth(workspacePath);
  if (healthReport.healthy) {
    const gitStatus = await sync.getGitStatus(workspacePath);
    sync.initSyncState(gitStatus);
    if (gitStatus.isRepo) sync.startCommitEngine(workspacePath);
    if (gitStatus.isRepo && gitStatus.hasRemote && gitStatus.branch) {
      sync.startPushPullEngine(workspacePath, gitStatus.branch);
      sync.startAutoSync();
    }
  }
  return { ok: true, healthReport };
});

ipcMain.handle('sync:recoverReclone', async () => {
  if (!workspacePath) return { ok: false, error: 'No workspace open' };
  const gitStatus = await sync.getGitStatus(workspacePath);
  if (!gitStatus.remoteUrl) return { ok: false, error: 'No remote URL configured' };
  const result = await sync.recoverReclone(workspacePath, gitStatus.remoteUrl);
  if (!result.ok) return result;
  const healthReport = await sync.checkRepoHealth(workspacePath);
  if (healthReport.healthy) {
    const freshStatus = await sync.getGitStatus(workspacePath);
    sync.initSyncState(freshStatus);
    if (freshStatus.isRepo) sync.startCommitEngine(workspacePath);
    if (freshStatus.isRepo && freshStatus.hasRemote && freshStatus.branch) {
      sync.startPushPullEngine(workspacePath, freshStatus.branch);
      sync.startAutoSync();
    }
  }
  return { ok: true, healthReport, backupPath: result.backupPath };
});

ipcMain.handle('sync:listBranches', async () => {
  if (!workspacePath) return [];
  return sync.listBranches(workspacePath);
});

// SEARCH DISABLED — Search IPC
//
// ipcMain.handle('search:query', (_e, queryString) => {
//   if (!searchIndex.isReady()) return { ready: false };
//   if (!queryString || !queryString.trim()) return { results: [], parsed: null };
//   try {
//     const results = searchIndex.query(queryString);
//     const parsed = parseSearchQuery(queryString);
//     return { results, parsed };
//   } catch (err) {
//     console.error('[search:query] error:', err);
//     return { error: err.message };
//   }
// });

// TAGS/BACKLINKS DISABLED — Tags IPC
//
// // Per-file promise-chain lock: serializes concurrent write operations on the
// // same file to prevent read-modify-write races. Map<filePath, Promise>.
// const _fileLocks = new Map();
//
// function _withFileLock(filePath, fn) {
//   const prev = _fileLocks.get(filePath) || Promise.resolve();
//   const next = prev.then(fn).finally(() => {
//     if (_fileLocks.get(filePath) === next) _fileLocks.delete(filePath);
//   });
//   _fileLocks.set(filePath, next);
//   return next;
// }
//
// ipcMain.handle('tags:list', () => {
//   return tagsIndex.getAllTags();
// });

ipcMain.handle('templates:list', () => {
  return templatesRegistry.getAll();
});

ipcMain.handle('templates:restoreDefaults', async () => {
  if (!workspacePath) return { restored: [] };
  const manifest = _remoteManifest || await getRemoteManifest();
  if (!manifest) return { restored: [] };
  let sourceDir = _remoteTemplatesDir;
  if (!sourceDir) {
    const result = await downloadTemplateFolders();
    if (!result) return { restored: [] };
    if (_remoteTmpDir) {
      try { fs.rmSync(_remoteTmpDir, { recursive: true, force: true }); } catch {}
    }
    _remoteTmpDir = result.tmpDir;
    _remoteTemplatesDir = result.templatesDir;
    sourceDir = result.templatesDir;
  }
  const tplPath = path.join(workspacePath, TEMPLATES_DIR_NAME);
  const restored = builtInTemplates.restoreBuiltInTemplates(tplPath, manifest, sourceDir);
  templatesRegistry.buildRegistry();
  mainWindow?.webContents.send('templates:restoreComplete', { restored });
  return { restored };
});

ipcMain.handle('templates:saveAsTemplate', async (_e, sourcePath, templateName) => {
  if (!workspacePath) return { ok: false, error: 'No workspace open' };

  if (!templateName || typeof templateName !== 'string') return { ok: false, error: 'Template name is required' };
  const trimmed = templateName.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return { ok: false, error: 'Invalid template name' };
  if (/[/\\:*?"<>|]/.test(trimmed)) return { ok: false, error: 'Template name contains invalid characters' };

  if (typeof sourcePath !== 'string' || !sourcePath) return { ok: false, error: 'Source path is required' };
  if (!isInsideWorkspace(sourcePath)) return { ok: false, error: 'Source path is outside the workspace' };

  // sourcePath should be a note folder (containing index.html)
  let sourceDir;
  try {
    const stat = fs.statSync(sourcePath);
    if (stat.isDirectory()) {
      sourceDir = sourcePath;
    } else {
      // If given a file path, use its parent directory
      sourceDir = path.dirname(sourcePath);
    }
  } catch (err) {
    return { ok: false, error: `Cannot read source: ${err.message}` };
  }

  const templatesPath = path.join(workspacePath, TEMPLATES_DIR_NAME);
  try {
    fs.mkdirSync(templatesPath, { recursive: true });
  } catch (err) {
    return { ok: false, error: `Cannot create _templates folder: ${err.message}` };
  }

  const destPath = path.join(templatesPath, trimmed);
  const overwritten = fs.existsSync(destPath);

  try {
    if (overwritten) fs.rmSync(destPath, { recursive: true, force: true });
    // Recursive copy excluding .notes-app/ local storage folder
    fs.cpSync(sourceDir, destPath, {
      recursive: true,
      filter: (src) => !src.split(path.sep).includes('.notes-app'),
    });
  } catch (err) {
    return { ok: false, error: `Cannot write template: ${err.message}` };
  }

  return { ok: true, templateName: trimmed, overwritten };
});

ipcMain.handle('preferences:getAuthor', () => {
  return prefs.getAuthor();
});

ipcMain.handle('preferences:getLastProvider', () => {
  return prefs.getLastProvider();
});

ipcMain.handle('preferences:setLastProvider', (_e, name) => {
  prefs.setLastProvider(name);
});

ipcMain.handle('preferences:getLastModel', () => {
  return prefs.getLastModel();
});

ipcMain.handle('preferences:setLastModel', (_e, provider, modelId) => {
  prefs.setLastModel(provider, modelId);
});

ipcMain.handle('providers:setActiveModel', (_e, modelId) => {
  setActiveModel(modelId);
});

ipcMain.handle('preferences:getLastEffort', () => {
  return prefs.getLastEffort();
});

ipcMain.handle('preferences:setLastEffort', (_e, provider, effortId) => {
  prefs.setLastEffort(provider, effortId);
});

ipcMain.handle('providers:setActiveEffort', (_e, effortId) => {
  setActiveEffort(effortId);
});

ipcMain.handle('preferences:getLastPermissionMode', () => {
  return prefs.getLastPermissionMode();
});

ipcMain.handle('preferences:setLastPermissionMode', (_e, provider, mode) => {
  prefs.setLastPermissionMode(provider, mode);
});

ipcMain.handle('providers:setActivePermissionMode', (_e, mode) => {
  setActivePermissionMode(mode);
});

ipcMain.handle('preferences:getUnsetApiKeys', () => {
  return prefs.getUnsetApiKeys();
});
ipcMain.handle('preferences:setUnsetApiKeys', (_e, value) => {
  prefs.setUnsetApiKeys(value);
});

// ── Debug logging (dev only) ──────────────────────────────────────────────────
const _debugLogPath = !app.isPackaged ? path.join(__dirname, 'logging', 'debug.log') : null;
function _debugLog(msg) {
  if (!_debugLogPath) return;
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(_debugLogPath, line); } catch {}
}
ipcMain.handle('debug:log', (_e, msg) => { _debugLog(msg); });

ipcMain.handle('preferences:getSidebarState', (_e, wsPath) => {
  const state = prefs.getSidebarState(wsPath);
  _debugLog('[main] getSidebarState(' + wsPath + ') => ' + JSON.stringify(state));
  return state;
});
ipcMain.handle('preferences:setSidebarStateKey', (_e, wsPath, key, value) => {
  _debugLog('[main] setSidebarStateKey(' + wsPath + ', ' + key + ', ' + value + ')');
  prefs.setSidebarStateKey(wsPath, key, value);
  _debugLog('[main] setSidebarStateKey done. verify: ' + JSON.stringify(prefs.getSidebarState(wsPath)));
});

// TAGS/BACKLINKS DISABLED — tags:files, tags:add, tags:remove, tags:all-file-tags
//
// ipcMain.handle('tags:files', (_e, tag) => {
//   if (typeof tag !== 'string' || !tag.trim()) {
//     return { success: false, error: 'Tag name is required' };
//   }
//   return tagsIndex.getFilesByTag(tag);
// });
//
// ipcMain.handle('tags:add', async (_e, filePath, tagNames) => {
//   if (!workspacePath) return { success: false, error: 'No workspace open' };
//   if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'filePath is required' };
//   if (!isInsideWorkspace(filePath)) return { success: false, error: 'Path is outside the workspace' };
//   if (!Array.isArray(tagNames) || tagNames.length === 0) return { success: false, error: 'tagNames must be a non-empty array' };
//   const invalid = tagNames.filter(t => !isValidTagName(t));
//   if (invalid.length > 0) return { success: false, error: `Invalid tag names: ${invalid.join(', ')}` };
//   try {
//     await fs.promises.access(filePath);
//   } catch {
//     return { success: false, error: 'File not found' };
//   }
//   return _withFileLock(filePath, async () => {
//     try {
//       const current = await parseTagsFromFile(filePath);
//       const lowerExisting = new Set(current.map(t => t.toLowerCase()));
//       const toAdd = tagNames.filter(t => !lowerExisting.has(t.toLowerCase()));
//       if (toAdd.length > 0) {
//         await writeTagsToFile(filePath, [...current, ...toAdd]);
//         await tagsIndex.refreshFile(filePath);
//       }
//       return { success: true };
//     } catch (err) {
//       return { success: false, error: err.message };
//     }
//   });
// });
//
// ipcMain.handle('tags:remove', async (_e, filePath, tagNames) => {
//   if (!workspacePath) return { success: false, error: 'No workspace open' };
//   if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'filePath is required' };
//   if (!isInsideWorkspace(filePath)) return { success: false, error: 'Path is outside the workspace' };
//   if (!Array.isArray(tagNames) || tagNames.length === 0) return { success: false, error: 'tagNames must be a non-empty array' };
//   const invalid = tagNames.filter(t => !isValidTagName(t));
//   if (invalid.length > 0) return { success: false, error: `Invalid tag names: ${invalid.join(', ')}` };
//   try {
//     await fs.promises.access(filePath);
//   } catch {
//     return { success: false, error: 'File not found' };
//   }
//   return _withFileLock(filePath, async () => {
//     try {
//       const current = await parseTagsFromFile(filePath);
//       const lowerRemove = new Set(tagNames.map(t => t.toLowerCase()));
//       const remaining = current.filter(t => !lowerRemove.has(t.toLowerCase()));
//       if (remaining.length !== current.length) {
//         await writeTagsToFile(filePath, remaining);
//         await tagsIndex.refreshFile(filePath);
//       }
//       return { success: true };
//     } catch (err) {
//       return { success: false, error: err.message };
//     }
//   });
// });
//
// ipcMain.handle('tags:all-file-tags', () => {
//   return tagsIndex.getAllFileTags();
// });

// BACKLINKS/GRAPH DISABLED — Backlinks IPC API (feature 126)
//
// ipcMain.handle('backlinks:get', (_e, relFilePath) => {
//   if (!workspacePath) return [];
//   if (typeof relFilePath !== 'string' || !relFilePath) return [];
//   const absPath = path.isAbsolute(relFilePath)
//     ? relFilePath
//     : path.join(workspacePath, relFilePath);
//   const absPaths = backlinksIndex.getBacklinks(absPath);
//   return absPaths;
// });
//
// // --- Graph View helpers (feature 127) ---
//
// function _extractNoteTitle(content, fileName) {
//   let m = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
//   if (m) {
//     const t = m[1].replace(/<[^>]+>/g, '').trim();
//     if (t) return t;
//   }
//   m = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
//   if (m) {
//     const t = m[1].replace(/<[^>]+>/g, '').trim();
//     if (t) return t;
//   }
//   return fileName.replace(/\.html$/i, '');
// }
//
// ipcMain.handle('graph:getData', async () => {
//   if (!workspacePath) return { nodes: [], edges: [] };
//
//   const sourceToTargets = backlinksIndex.getSourceToTargets();
//
//   const allFiles = builder.collectFiles(workspacePath);
//   const htmlFiles = allFiles.filter(f => f.ext === '.html');
//
//   const knownAbsPaths = new Set(htmlFiles.map(f => f.fullPath));
//
//   const nodes = [];
//   for (const { fullPath } of htmlFiles) {
//     const name = path.basename(fullPath);
//     const relPath = path.relative(workspacePath, fullPath);
//     let title = name.replace(/\.html$/i, '');
//     try {
//       const content = await fs.promises.readFile(fullPath, 'utf8');
//       title = _extractNoteTitle(content, name);
//     } catch { /* unreadable — use filename fallback */ }
//     nodes.push({ id: relPath, title, path: relPath });
//   }
//
//   const edges = [];
//   const edgeSet = new Set();
//   for (const [absSource, targets] of sourceToTargets) {
//     if (!knownAbsPaths.has(absSource)) continue;
//     const relSource = path.relative(workspacePath, absSource);
//     for (const absTarget of targets) {
//       if (!knownAbsPaths.has(absTarget)) continue;
//       const relTarget = path.relative(workspacePath, absTarget);
//       if (relSource === relTarget) continue;
//       const key = `${relSource}→${relTarget}`;
//       const key = `${relSource}→${relTarget}`;
//       if (edgeSet.has(key)) continue;
//       edgeSet.add(key);
//       edges.push({ source: relSource, target: relTarget });
//     }
//   }
//
//   return { nodes, edges };
// });

// --- Favorites IPC API (feature 119) ---

ipcMain.handle('favorites:list', () => {
  return favorites.list();
});

ipcMain.handle('favorites:add', (_e, relPath) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (typeof relPath !== 'string' || !relPath.trim()) throw new Error('relPath must be a non-empty string');
  const absPath = path.join(workspacePath, relPath);
  if (!isInsideWorkspace(absPath)) throw new Error('Path is outside the workspace');
  if (!fs.existsSync(absPath)) throw new Error(`File does not exist: ${relPath}`);
  const before = favorites.list();
  const updated = favorites.add(workspacePath, relPath);
  if (updated.length !== before.length) {
    mainWindow?.webContents.send('favorites:changed', updated);
  }
  return updated;
});

ipcMain.handle('favorites:remove', (_e, relPath) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (typeof relPath !== 'string' || !relPath.trim()) throw new Error('relPath must be a non-empty string');
  const before = favorites.list();
  const updated = favorites.remove(workspacePath, relPath);
  if (updated.length !== before.length) {
    mainWindow?.webContents.send('favorites:changed', updated);
  }
  return updated;
});

ipcMain.handle('favorites:reorder', (_e, newArray) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (!Array.isArray(newArray) || newArray.length === 0) throw new Error('newArray must be a non-empty array');
  if (!newArray.every(p => typeof p === 'string' && p.trim())) throw new Error('All entries must be non-empty strings');
  for (const relPath of newArray) {
    const absPath = path.join(workspacePath, relPath);
    if (!isInsideWorkspace(absPath)) throw new Error(`Path is outside the workspace: ${relPath}`);
    if (!fs.existsSync(absPath)) throw new Error(`File does not exist: ${relPath}`);
  }
  const updated = favorites.reorder(workspacePath, newArray);
  mainWindow?.webContents.send('favorites:changed', updated);
  return updated;
});

ipcMain.handle('favorites:rename', (_e, oldRelPath, newRelPath) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (typeof oldRelPath !== 'string' || !oldRelPath.trim()) throw new Error('oldRelPath must be a non-empty string');
  if (typeof newRelPath !== 'string' || !newRelPath.trim()) throw new Error('newRelPath must be a non-empty string');
  const before = favorites.list();
  const updated = favorites.rename(workspacePath, oldRelPath, newRelPath);
  const changed = before.includes(oldRelPath) && updated.includes(newRelPath);
  if (changed) {
    mainWindow?.webContents.send('favorites:changed', updated);
  }
  return updated;
});

// --- Note KV store (feature 94) ---
// noteDB helpers are in note-db.js (extracted for feature 144)

ipcMain.handle('note-db:get', (_e, noteId, key) => {
  if (!workspacePath) return null;
  if (typeof noteId !== 'string' || !noteId) return null;
  if (typeof key !== 'string' || !key) return null;
  if (!noteDb.noteDbPath(workspacePath, noteId)) return null; // path traversal guard
  const data = noteDb.noteDbLoad(workspacePath, noteId);
  const val = data[key];
  return (val !== undefined) ? val : null;
});

ipcMain.handle('note-db:set', (_e, noteId, key, value) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (typeof noteId !== 'string' || !noteId) throw new Error('noteId must be a non-empty string');
  if (typeof key !== 'string' || !key) throw new Error('key must be a non-empty string');
  if (value === undefined) throw new Error('value is required');
  if (!noteDb.noteDbPath(workspacePath, noteId)) throw new Error('Invalid noteId (path traversal detected)');
  const data = noteDb.noteDbLoad(workspacePath, noteId);
  data[key] = value;
  noteDb.noteDbFlush(workspacePath, noteId, data);
  syncManager.onKvWrite(noteId, key, value, false);
});

ipcMain.handle('note-db:delete', (_e, noteId, key) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (typeof noteId !== 'string' || !noteId) throw new Error('noteId must be a non-empty string');
  if (typeof key !== 'string' || !key) throw new Error('key must be a non-empty string');
  if (!noteDb.noteDbPath(workspacePath, noteId)) throw new Error('Invalid noteId (path traversal detected)');
  const data = noteDb.noteDbLoad(workspacePath, noteId);
  if (Object.prototype.hasOwnProperty.call(data, key)) {
    delete data[key];
    noteDb.noteDbFlush(workspacePath, noteId, data);
    syncManager.onKvWrite(noteId, key, null, true);
  }
});

ipcMain.handle('note-db:list', (_e, noteId) => {
  if (!workspacePath) return [];
  if (typeof noteId !== 'string' || !noteId) return [];
  if (!noteDb.noteDbPath(workspacePath, noteId)) return [];
  const data = noteDb.noteDbLoad(workspacePath, noteId);
  return Object.keys(data);
});

// --- KV Sync IPC handlers (feature 144) ---

ipcMain.handle('aws-sync:getKvStatus', () => syncManager.getStatus().kv);

ipcMain.handle('aws-sync:syncKvNow', async () => {
  if (!auth.isLoggedIn()) return { ok: false, reason: 'not-logged-in' };
  if (!workspacePath) return { ok: false, reason: 'no-workspace' };
  return syncManager.syncKvNow();
});

// --- Files Sync IPC handlers (feature 145) ---

ipcMain.handle('aws-sync:getFilesStatus', () => syncManager.getStatus().files);

ipcMain.handle('aws-sync:syncFilesNow', async () => {
  if (!auth.isLoggedIn()) return { ok: false, reason: 'not-logged-in' };
  if (!workspacePath) return { ok: false, reason: 'no-workspace' };
  return syncManager.syncFilesNow();
});

// --- Unified AWS Sync IPC (feature 146) ---
ipcMain.handle('aws-sync:getStatus', () => syncManager.getStatus());
ipcMain.handle('aws-sync:syncNow', async () => {
  await syncManager.syncNow();
  return syncManager.getStatus();
});

// --- AWS Sync opt-in controls (feature 148) ---

ipcMain.handle('aws-sync:enable', async () => {
  prefs.setAwsSyncEnabled(true);
  prefs.setAwsSyncPaused(false);
  if (auth.isLoggedIn() && workspacePath) {
    syncManager.stop(); // clear any leftover timers before re-starting
    await syncManager.init(workspacePath).catch(() => {});
    syncManager.start();
  }
  return syncManager.getStatus();
});

ipcMain.handle('aws-sync:disable', () => {
  prefs.setAwsSyncEnabled(false);
  prefs.setAwsSyncPaused(false);
  syncManager.clearState();
  return syncManager.getStatus();
});

ipcMain.handle('aws-sync:pause', () => {
  syncManager.pause();
  prefs.setAwsSyncPaused(true);
  return syncManager.getStatus();
});

ipcMain.handle('aws-sync:resume', () => {
  syncManager.resume();
  prefs.setAwsSyncPaused(false);
  return syncManager.getStatus();
});

ipcMain.handle('aws-sync:unlink', async (_e, opts) => {
  const { clearLocal = true, purgeCloud = false } = opts || {};
  if (purgeCloud) {
    const syncApi = require('./sync-api');
    const result = await syncApi.post('/notes/sync/purge', {});
    if (!result.ok) {
      process.stderr.write(`aws-sync purge failed: ${result.error}\n`);
    }
  }
  if (clearLocal) {
    prefs.setAwsSyncEnabled(false);
    syncManager.clearState();
  }
  return syncManager.getStatus();
});

// --- AWS Sync first-run consent preference (feature 149) ---

ipcMain.handle('preferences:getAwsSyncPromptShown', () => {
  return prefs.getAwsSyncPromptShown();
});

ipcMain.handle('preferences:setAwsSyncPromptShown', (_e, value) => {
  prefs.setAwsSyncPromptShown(value);
});

// --- Theme preference (feature 153) ---

// Synchronous: called from preload before first paint to avoid FOUC.
// Returns "dark" or "light". If no saved preference, falls back to OS.
ipcMain.on('theme:get', (event) => {
  const saved = prefs.getTheme();
  if (saved) {
    event.returnValue = saved;
  } else {
    event.returnValue = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
});

ipcMain.handle('theme:set', (_e, theme) => {
  prefs.setTheme(theme);
  terminalManager.notifyThemeChanged(theme);
});

ipcMain.handle('theme:getCurrent', () => {
  const saved = prefs.getTheme();
  if (saved) return saved;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

// --- Sync ignore IPC handlers ---

ipcMain.handle('sync-ignore:read', async (_e, type) => {
  if (!workspacePath) return '';
  const fileName = type === 'git' ? '.gitignore' : '.syncignore';
  try {
    return await fs.promises.readFile(path.join(workspacePath, fileName), 'utf8');
  } catch {
    return '';
  }
});

ipcMain.handle('sync-ignore:write', async (_e, type, content) => {
  if (!workspacePath) return;
  const fileName = type === 'git' ? '.gitignore' : '.syncignore';
  await fs.promises.writeFile(path.join(workspacePath, fileName), content, 'utf8');
});

// --- Server Sync (SSH/SFTP) IPC handlers ---

function _buildSshConfig(ep) {
  const sshSyncAuth = require('./providers/ssh-sync-auth');
  const config = {
    host: ep.sshHost,
    port: ep.sshPort || 22,
    username: ep.sshUsername,
    remotePath: ep.sshRemotePath,
  };
  if (ep.sshAuthMethod === 'agent') {
    config.agent = process.env.SSH_AUTH_SOCK || (() => {
      try { return require('child_process').execSync('launchctl getenv SSH_AUTH_SOCK', { encoding: 'utf8' }).trim(); } catch { return undefined; }
    })();
  } else if (ep.sshAuthMethod === 'key') {
    config.privateKeyPath = ep.sshKeyPath;
  } else if (ep.sshAuthMethod === 'password') {
    config.password = sshSyncAuth.readSshPassword(ep.id);
  }
  return config;
}

function _migrateSshSyncEndpoints() {
  const p = prefs.load();
  if (p.sshSyncMigrated) return;
  const openclawEps = p.openclawRemoteEndpoints || [];
  const sshEps = [];
  const ocAuth = require('./providers/openclaw-remote-auth');
  const sshSyncAuth = require('./providers/ssh-sync-auth');
  const fs = require('fs');
  const path = require('path');
  for (const ep of openclawEps) {
    if (ep.sshHost || ep.syncEnabled) {
      const newId = ep.id + '-ssh';
      sshEps.push({
        id: newId,
        label: (ep.label || 'Untitled') + ' (SSH)',
        sshHost: ep.sshHost,
        sshPort: ep.sshPort || 22,
        sshUsername: ep.sshUsername,
        sshAuthMethod: ep.sshAuthMethod || 'agent',
        sshKeyPath: ep.sshKeyPath,
        sshRemotePath: ep.sshRemotePath,
        syncEnabled: !!ep.syncEnabled,
      });
      // Copy state files from old dir to new dir
      const oldDir = ocAuth.getEndpointDir(ep.id);
      const newDir = sshSyncAuth.getEndpointDir(newId);
      for (const fname of ['ssh-password.enc', 'server-sync-state.json']) {
        try {
          const src = path.join(oldDir, fname);
          if (fs.existsSync(src)) {
            fs.mkdirSync(newDir, { recursive: true });
            fs.copyFileSync(src, path.join(newDir, fname));
          }
        } catch {}
      }
      // Strip SSH fields from the OpenClaw endpoint
      delete ep.sshHost; delete ep.sshPort; delete ep.sshUsername;
      delete ep.sshAuthMethod; delete ep.sshKeyPath; delete ep.sshRemotePath;
      delete ep.syncEnabled;
    }
  }
  if (sshEps.length > 0) {
    p.sshSyncEndpoints = sshEps;
  }
  p.openclawRemoteEndpoints = openclawEps;
  p.sshSyncMigrated = true;
  prefs.save(p);
}

function _initServerSyncEndpoints(wsPath) {
  _migrateSshSyncEndpoints();
  const endpoints = prefs.getSshSyncEndpoints();
  const pausedIds = new Set(prefs.getServerSyncPausedEndpoints());
  for (const ep of endpoints) {
    if (!ep.syncEnabled || !ep.sshHost || !ep.sshRemotePath) continue;
    const sshConfig = _buildSshConfig(ep);
    serverSyncManager.initEndpoint(ep.id, wsPath, sshConfig);
    // Restore persisted pause state
    if (pausedIds.has(ep.id)) {
      serverSyncManager.pauseEndpoint(ep.id);
    }
  }
  serverSyncManager.start();
}

ipcMain.handle('server-sync:getStatus', () => {
  return serverSyncManager.getStatus();
});

ipcMain.handle('server-sync:getEndpointStatus', (_e, endpointId) => {
  return serverSyncManager.getEndpointStatus(endpointId);
});

ipcMain.handle('server-sync:enable', async (_e, endpointId) => {
  const endpoints = prefs.getSshSyncEndpoints();
  const ep = endpoints.find(e => e.id === endpointId);
  if (!ep) return { ok: false, error: 'endpoint-not-found' };
  if (!workspacePath) return { ok: false, error: 'no-workspace' };

  ep.syncEnabled = true;
  prefs.setSshSyncEndpoints(endpoints);
  // Clear from persisted paused list
  const pausedAfterEnable = prefs.getServerSyncPausedEndpoints().filter(id => id !== endpointId);
  prefs.setServerSyncPausedEndpoints(pausedAfterEnable);

  const sshConfig = _buildSshConfig(ep);
  serverSyncManager.initEndpoint(endpointId, workspacePath, sshConfig);
  serverSyncManager.startEndpoint(endpointId);
  return serverSyncManager.getEndpointStatus(endpointId);
});

ipcMain.handle('server-sync:disable', (_e, endpointId) => {
  const endpoints = prefs.getSshSyncEndpoints();
  const ep = endpoints.find(e => e.id === endpointId);
  if (ep) {
    ep.syncEnabled = false;
    prefs.setSshSyncEndpoints(endpoints);
  }
  // Clear from persisted paused list
  const pausedAfterDisable = prefs.getServerSyncPausedEndpoints().filter(id => id !== endpointId);
  prefs.setServerSyncPausedEndpoints(pausedAfterDisable);
  serverSyncManager.stopEndpoint(endpointId);
  return serverSyncManager.getEndpointStatus(endpointId);
});

ipcMain.handle('server-sync:pauseAll', () => {
  serverSyncManager.pauseAll();
  // Persist paused endpoint IDs
  const status = serverSyncManager.getStatus();
  const pausedIds = Object.entries(status).filter(([, s]) => s.state === 'paused').map(([id]) => id);
  prefs.setServerSyncPausedEndpoints(pausedIds);
  return status;
});

ipcMain.handle('server-sync:resumeAll', () => {
  serverSyncManager.resumeAll();
  prefs.setServerSyncPausedEndpoints([]);
  return serverSyncManager.getStatus();
});

ipcMain.handle('server-sync:syncNow', async (_e, endpointId) => {
  return serverSyncManager.syncNow(endpointId);
});

ipcMain.handle('server-sync:testSsh', async (_e, sshConfig) => {
  const { ServerSftp } = require('./server-sftp');
  // Resolve agent flag into actual SSH_AUTH_SOCK path
  if (sshConfig.agent === true) {
    sshConfig.agent = process.env.SSH_AUTH_SOCK || (() => {
      try { return require('child_process').execSync('launchctl getenv SSH_AUTH_SOCK', { encoding: 'utf8' }).trim(); } catch { return undefined; }
    })();
  }
  const sftp = new ServerSftp(sshConfig);
  const start = Date.now();
  try {
    await sftp.connect();
    const files = await sftp.listFiles(sshConfig.remotePath);
    const latencyMs = Date.now() - start;
    sftp.disconnect();
    return { ok: true, fileCount: files.length, latencyMs };
  } catch (err) {
    sftp.disconnect();
    return { ok: false, error: err.message };
  }
});

// --- SSH Sync endpoint CRUD ---

ipcMain.handle('ssh-sync:getEndpoints', () => {
  return prefs.getSshSyncEndpoints();
});

ipcMain.handle('ssh-sync:add', async (_e, endpoint) => {
  const { randomUUID } = require('crypto');
  const sshSyncAuth = require('./providers/ssh-sync-auth');
  const id = endpoint.id || randomUUID();
  const newEndpoint = { ...endpoint, id };
  if (newEndpoint.sshPassword) {
    sshSyncAuth.writeSshPassword(id, newEndpoint.sshPassword);
  }
  delete newEndpoint.sshPassword;
  const endpoints = prefs.getSshSyncEndpoints();
  endpoints.push(newEndpoint);
  prefs.setSshSyncEndpoints(endpoints);
  mainWindow?.webContents.send('ssh-sync:endpointsChanged');
  return newEndpoint;
});

ipcMain.handle('ssh-sync:update', async (_e, endpoint) => {
  const sshSyncAuth = require('./providers/ssh-sync-auth');
  const endpoints = prefs.getSshSyncEndpoints();
  const idx = endpoints.findIndex(e => e.id === endpoint.id);
  if (idx === -1) return { ok: false, error: 'endpoint-not-found' };
  if (endpoint.sshPassword) {
    sshSyncAuth.writeSshPassword(endpoint.id, endpoint.sshPassword);
  }
  const { sshPassword, ...rest } = endpoint;
  endpoints[idx] = { ...endpoints[idx], ...rest };
  prefs.setSshSyncEndpoints(endpoints);
  mainWindow?.webContents.send('ssh-sync:endpointsChanged');
  return { ok: true };
});

ipcMain.handle('ssh-sync:remove', async (_e, endpointId) => {
  const sshSyncAuth = require('./providers/ssh-sync-auth');
  const endpoints = prefs.getSshSyncEndpoints();
  const filtered = endpoints.filter(e => e.id !== endpointId);
  if (filtered.length === endpoints.length) return { ok: false, error: 'endpoint-not-found' };
  prefs.setSshSyncEndpoints(filtered);
  sshSyncAuth.deleteEndpointData(endpointId);
  serverSyncManager.removeEndpoint(endpointId);
  mainWindow?.webContents.send('ssh-sync:endpointsChanged');
  return { ok: true };
});

// --- Per-note context IPC (KV schema + memory.md) ---

ipcMain.handle('note-kv:schema', (_e, noteId) => {
  if (!workspacePath) return null;
  if (typeof noteId !== 'string' || !noteId) return null;
  if (!noteDb.noteDbPath(workspacePath, noteId)) return null;
  const data = noteDb.noteDbLoad(workspacePath, noteId);
  if (Object.keys(data).length === 0) return null;
  function describeType(val) {
    if (val === null) return 'null';
    if (Array.isArray(val)) return `array (${val.length} items)`;
    if (typeof val === 'object') {
      const keys = Object.keys(val);
      if (keys.length <= 6) {
        const entries = keys.map(k => `${k}: ${describeType(val[k])}`);
        return `{ ${entries.join(', ')} }`;
      }
      return `object (${keys.length} keys)`;
    }
    return typeof val;
  }
  const schema = {};
  for (const [key, val] of Object.entries(data)) {
    schema[key] = describeType(val);
  }
  return schema;
});

ipcMain.handle('note-memory:read', (_e, noteId) => {
  if (!workspacePath) return null;
  if (typeof noteId !== 'string' || !noteId) return null;
  const memPath = path.resolve(path.join(workspacePath, noteId, 'memory.md'));
  if (!memPath.startsWith(workspacePath + path.sep)) return null;
  if (!fs.existsSync(memPath)) return null;
  try {
    const content = fs.readFileSync(memPath, 'utf8');
    // Truncate to ~3000 chars to avoid bloating prompts
    return content.length > 3000 ? content.slice(0, 3000) + '\n…(truncated)' : content;
  } catch {
    return null;
  }
});

ipcMain.handle('note-memory:write', (_e, noteId, content) => {
  if (!workspacePath) return false;
  if (typeof noteId !== 'string' || !noteId) return false;
  if (typeof content !== 'string') return false;
  const memPath = path.resolve(path.join(workspacePath, noteId, 'memory.md'));
  if (!memPath.startsWith(workspacePath + path.sep)) return false;
  try {
    const dir = path.dirname(memPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(memPath, content, 'utf8');
    return true;
  } catch {
    return false;
  }
});

// --- Note file store (feature 95) ---

// Returns the files/ directory path for a note. Returns null on path-traversal attempt.
function noteFilesDir(noteId) {
  if (!workspacePath) return null;
  const dir = path.resolve(path.join(workspacePath, noteId, 'storage', 'files'));
  if (!dir.startsWith(workspacePath + path.sep)) return null;
  return dir;
}

// Returns true if name is a safe, flat filename (no path traversal, no directory separators).
function isValidNoteFileName(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  return true;
}

ipcMain.handle('note-files:save', (_e, noteId, name, data) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (typeof noteId !== 'string' || !noteId) throw new Error('noteId must be a non-empty string');
  if (!isValidNoteFileName(name)) throw new Error('Invalid file name');
  const dir = noteFilesDir(noteId);
  if (!dir) throw new Error('Invalid noteId (path traversal detected)');
  const filePath = path.resolve(path.join(dir, name));
  if (!filePath.startsWith(dir + path.sep)) throw new Error('Invalid file name (path traversal detected)');
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + '.tmp';
  let buf;
  if (typeof data === 'string') {
    buf = Buffer.from(data, 'utf8');
  } else {
    buf = Buffer.from(data); // handles ArrayBuffer and Uint8Array
  }
  try {
    fs.writeFileSync(tmpPath, buf);
    fs.renameSync(tmpPath, filePath);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
  syncManager.onFileSave(noteId, name);
});

ipcMain.handle('note-files:load', (_e, noteId, name) => {
  if (!workspacePath) return null;
  if (typeof noteId !== 'string' || !noteId) return null;
  if (!isValidNoteFileName(name)) return null;
  const dir = noteFilesDir(noteId);
  if (!dir) return null;
  const filePath = path.join(dir, name);
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  // Return a proper ArrayBuffer (not a Buffer/Uint8Array) so the renderer receives ArrayBuffer.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

ipcMain.handle('note-files:delete', (_e, noteId, name) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (typeof noteId !== 'string' || !noteId) throw new Error('noteId must be a non-empty string');
  if (!isValidNoteFileName(name)) throw new Error('Invalid file name');
  const dir = noteFilesDir(noteId);
  if (!dir) throw new Error('Invalid noteId (path traversal detected)');
  const filePath = path.join(dir, name);
  try { fs.unlinkSync(filePath); } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  syncManager.onFileDelete(noteId, name);
});

ipcMain.handle('note-files:list', (_e, noteId) => {
  if (!workspacePath) return [];
  if (typeof noteId !== 'string' || !noteId) return [];
  const dir = noteFilesDir(noteId);
  if (!dir) return [];
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
});

ipcMain.handle('note-files:import', async (_e, noteId, options) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (typeof noteId !== 'string' || !noteId) throw new Error('noteId must be a non-empty string');
  const dir = noteFilesDir(noteId);
  if (!dir) throw new Error('Invalid noteId (path traversal detected)');
  const filters = Array.isArray(options?.filters) ? options.filters : [];
  const dialogOpts = { properties: ['openFile'] };
  if (filters.length) dialogOpts.filters = filters;
  const result = await dialog.showOpenDialog(mainWindow, dialogOpts);
  if (result.canceled || result.filePaths.length === 0) return null;
  const srcPath = result.filePaths[0];
  const basename = path.basename(srcPath);
  if (!isValidNoteFileName(basename)) throw new Error('Invalid file name');
  fs.mkdirSync(dir, { recursive: true });
  const destPath = path.join(dir, basename);
  fs.copyFileSync(srcPath, destPath);
  syncManager.onFileSave(noteId, basename);
  return basename;
});

// --- Note SQL database (feature 96) ---

// Resolves and validates the db.sqlite path for a note. Returns null on path-traversal attempt.
function noteSqlDbPath(noteId) {
  if (!workspacePath) return null;
  const dbPath = path.resolve(path.join(workspacePath, noteId, 'storage', 'db.sqlite'));
  if (!dbPath.startsWith(workspacePath + path.sep)) return null;
  return dbPath;
}

// Returns an open (cached) Database handle for the note. Creates file and dirs lazily.
function noteSqlOpen(noteId) {
  if (noteSqlCache.has(noteId)) return noteSqlCache.get(noteId);
  const dbPath = noteSqlDbPath(noteId);
  if (!dbPath) throw new Error('Invalid noteId (path traversal detected)');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  noteSqlCache.set(noteId, db);
  return db;
}

// Opens a read-only (cached) Database handle for inspection. Returns null if the db file doesn't exist.
// Unlike noteSqlOpen(), this never creates the database file.
function noteSqlOpenReadonly(noteId) {
  if (noteSqlReadonlyCache.has(noteId)) return noteSqlReadonlyCache.get(noteId);
  const dbPath = noteSqlDbPath(noteId);
  if (!dbPath) return null;
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  noteSqlReadonlyCache.set(noteId, db);
  return db;
}

ipcMain.handle('note-sql:exec', (_e, noteId, sql, params) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (typeof noteId !== 'string' || !noteId) throw new Error('noteId must be a non-empty string');
  if (typeof sql !== 'string' || !sql) throw new Error('sql must be a non-empty string');
  if (params !== undefined && !Array.isArray(params)) throw new Error('params must be an array');
  if (!noteSqlDbPath(noteId)) throw new Error('Invalid noteId (path traversal detected)');
  const db = noteSqlOpen(noteId);
  const stmt = db.prepare(sql);
  const result = stmt.run(...(params || []));
  return { changes: result.changes };
});

ipcMain.handle('note-sql:query', (_e, noteId, sql, params) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (typeof noteId !== 'string' || !noteId) throw new Error('noteId must be a non-empty string');
  if (typeof sql !== 'string' || !sql) throw new Error('sql must be a non-empty string');
  if (params !== undefined && !Array.isArray(params)) throw new Error('params must be an array');
  if (!noteSqlDbPath(noteId)) throw new Error('Invalid noteId (path traversal detected)');
  const db = noteSqlOpen(noteId);
  const stmt = db.prepare(sql);
  return stmt.all(...(params || []));
});

// --- Storage Inspector IPC (feature 137) ---

ipcMain.handle('note-db:list-all', (_e, noteId) => {
  if (!workspacePath) return [];
  if (typeof noteId !== 'string' || !noteId) return [];
  if (!noteDb.noteDbPath(workspacePath, noteId)) return [];
  const data = noteDb.noteDbLoad(workspacePath, noteId);
  return Object.entries(data).map(([key, value]) => {
    const type = typeof value;
    let str;
    if (type === 'string') {
      str = value;
    } else {
      str = JSON.stringify(value);
    }
    const truncated = str.length > 500 ? str.slice(0, 500) + '\u2026' : str;
    return { key, value: truncated, type };
  });
});

ipcMain.handle('note-files:list-details', (_e, noteId) => {
  if (!workspacePath) return [];
  if (typeof noteId !== 'string' || !noteId) return [];
  const dir = noteFilesDir(noteId);
  if (!dir) return [];
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir);
  const results = [];
  for (const name of names) {
    try {
      const stat = fs.statSync(path.join(dir, name));
      results.push({ name, size: stat.size, modified: stat.mtime.toISOString() });
    } catch {
      // Skip files that fail statSync (broken symlinks, race conditions)
    }
  }
  return results;
});

// --- Note scripts (feature 110) ---

function noteScriptsDir(noteId) {
  if (!workspacePath) return null;
  const dir = path.resolve(path.join(workspacePath, noteId, 'scripts'));
  if (!dir.startsWith(workspacePath + path.sep)) return null;
  return dir;
}

function noteScriptsLogsDir(noteId) {
  const scriptsDir = noteScriptsDir(noteId);
  if (!scriptsDir) return null;
  return path.join(scriptsDir, 'logs');
}

function _rotateLogFile(filePath, maxBytes) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const keepFrom = Math.floor(content.length * 0.4);
      const newContent = content.slice(keepFrom);
      const firstNewline = newContent.indexOf('\n');
      fs.writeFileSync(filePath, firstNewline >= 0 ? newContent.slice(firstNewline + 1) : newContent);
    }
  } catch {}
}

function scriptWhitelistPath() {
  if (!workspacePath) return null;
  return path.join(workspacePath, '.notes-app', 'script-whitelist.json');
}

function readScriptWhitelist() {
  const p = scriptWhitelistPath();
  if (!p) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

function writeScriptWhitelist(wl) {
  const p = scriptWhitelistPath();
  if (!p) return;
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = p + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(wl, null, 2));
    fs.renameSync(tmp, p);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function isScriptApproved(noteId, scriptName) {
  const wl = readScriptWhitelist();
  const list = wl[noteId];
  return Array.isArray(list) && list.includes(scriptName);
}

function resolveInterpreter(scriptPath, envConfig) {
  const ext = path.extname(scriptPath).toLowerCase();
  if (ext === '.py') {
    const python = (envConfig && envConfig.pythonPath) || 'python3';
    return [python, scriptPath];
  }
  if (ext === '.sh') return ['bash', scriptPath];
  if (ext === '.js') return ['node', scriptPath];
  if (ext === '.rb') return ['ruby', scriptPath];
  return [scriptPath];
}

function _buildScriptEnv(noteId, envConfig) {
  const env = { ...process.env, NOTE_ID: noteId, WORKSPACE_PATH: workspacePath };
  if (envConfig && envConfig.pythonPath) {
    const venvBin = path.dirname(envConfig.pythonPath);
    env.PATH = venvBin + path.delimiter + (env.PATH || '');
    env.VIRTUAL_ENV = path.dirname(venvBin);
  }
  return env;
}

ipcMain.handle('note-scripts:list', (_e, noteId) => {
  if (!workspacePath) return [];
  if (typeof noteId !== 'string' || !noteId) return [];
  const dir = noteScriptsDir(noteId);
  if (!dir) return [];
  if (!fs.existsSync(dir)) return [];
  const wl = readScriptWhitelist();
  const approved = Array.isArray(wl[noteId]) ? wl[noteId] : [];
  const names = fs.readdirSync(dir);
  const results = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    try {
      const stat = fs.statSync(path.join(dir, name));
      if (!stat.isFile()) continue;
      results.push({ name, size: stat.size, modified: stat.mtime.toISOString(), approved: approved.includes(name) });
    } catch {}
  }
  return results;
});

ipcMain.handle('note-scripts:approve', (_e, noteId, scriptName) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (typeof noteId !== 'string' || !noteId) throw new Error('noteId required');
  if (!isValidNoteFileName(scriptName)) throw new Error('Invalid script name');
  const dir = noteScriptsDir(noteId);
  if (!dir) throw new Error('Invalid noteId');
  const scriptPath = path.join(dir, scriptName);
  if (!fs.existsSync(scriptPath)) throw new Error('Script not found on disk');
  const wl = readScriptWhitelist();
  if (!Array.isArray(wl[noteId])) wl[noteId] = [];
  if (!wl[noteId].includes(scriptName)) wl[noteId].push(scriptName);
  writeScriptWhitelist(wl);
  return true;
});

ipcMain.handle('note-scripts:revoke', (_e, noteId, scriptName) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (typeof noteId !== 'string' || !noteId) throw new Error('noteId required');
  if (!isValidNoteFileName(scriptName)) throw new Error('Invalid script name');
  const wl = readScriptWhitelist();
  if (Array.isArray(wl[noteId])) {
    wl[noteId] = wl[noteId].filter(n => n !== scriptName);
    if (wl[noteId].length === 0) delete wl[noteId];
  }
  writeScriptWhitelist(wl);
  return true;
});

// --- Script process tracking ---
const _runningScripts = new Map();
let _nextRunId = 1;

function _notifyScriptsRunChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scripts:runChanged');
  }
}

// Common import-name → pip-package-name mismatches
const _importToPackage = {
  PIL: 'Pillow', cv2: 'opencv-python', sklearn: 'scikit-learn',
  yaml: 'pyyaml', bs4: 'beautifulsoup4', attr: 'attrs',
  dotenv: 'python-dotenv', gi: 'PyGObject', serial: 'pyserial',
  usb: 'pyusb', Crypto: 'pycryptodome', jwt: 'PyJWT',
  magic: 'python-magic', docx: 'python-docx', pptx: 'python-pptx',
};

function _detectMissingModule(stderr) {
  // Python: ModuleNotFoundError: No module named 'X'
  let m = stderr.match(/ModuleNotFoundError: No module named '([^'.]+)'/);
  if (m) {
    const mod = m[1];
    const pkg = _importToPackage[mod] || mod;
    return { lang: 'python', module: mod, install: `pip install ${pkg}` };
  }
  // Node: Cannot find module 'X'
  m = stderr.match(/Cannot find module '([^']+)'/);
  if (m && !m[1].startsWith('.') && !m[1].startsWith('/')) {
    return { lang: 'node', module: m[1], install: `npm install ${m[1]}` };
  }
  // Ruby: cannot load such file -- X (LoadError)
  m = stderr.match(/cannot load such file -- (\S+)/);
  if (m) {
    return { lang: 'ruby', module: m[1], install: `gem install ${m[1]}` };
  }
  return null;
}

function _notifyMissingModule(noteId, scriptName, hint) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scripts:missingModule', { noteId, scriptName, ...hint });
  }
}

ipcMain.handle('note-scripts:running', () => {
  const result = [];
  for (const [runId, entry] of _runningScripts) {
    result.push({ runId, noteId: entry.noteId, scriptName: entry.scriptName, startedAt: entry.startedAt });
  }
  return result;
});

ipcMain.handle('note-scripts:stop', (_e, runId) => {
  const entry = _runningScripts.get(runId);
  if (!entry) return false;
  try { entry.process.kill(); } catch {}
  return true;
});

// Kill all running instances of a script for a given note (used by webview chat cancel)
ipcMain.handle('note-scripts:stop-by-name', (_e, noteId, scriptName) => {
  let killed = 0;
  for (const [, entry] of _runningScripts) {
    if (entry.noteId === noteId && entry.scriptName === scriptName) {
      try { entry.process.kill(); killed++; } catch {}
    }
  }
  return killed;
});

ipcMain.handle('note-scripts:run', (_e, noteId, scriptName, args) => {
  if (!workspacePath) return { stdout: '', stderr: 'No workspace open', exitCode: -1, error: 'no_workspace' };
  if (typeof noteId !== 'string' || !noteId) return { stdout: '', stderr: 'Invalid noteId', exitCode: -1, error: 'invalid_note' };
  if (!isValidNoteFileName(scriptName)) return { stdout: '', stderr: 'Invalid script name', exitCode: -1, error: 'invalid_name' };
  // Validate args
  if (args !== undefined && args !== null) {
    if (!Array.isArray(args)) return { stdout: '', stderr: 'args must be an array', exitCode: -1, error: 'invalid_args' };
    if (args.length > 50) return { stdout: '', stderr: 'Too many arguments', exitCode: -1, error: 'invalid_args' };
    for (const a of args) {
      if (typeof a !== 'string') return { stdout: '', stderr: 'All args must be strings', exitCode: -1, error: 'invalid_args' };
    }
  }
  const dir = noteScriptsDir(noteId);
  if (!dir) return { stdout: '', stderr: 'Invalid noteId', exitCode: -1, error: 'invalid_note' };
  const scriptPath = path.resolve(path.join(dir, scriptName));
  if (!scriptPath.startsWith(dir + path.sep) && scriptPath !== dir) {
    return { stdout: '', stderr: 'Path traversal detected', exitCode: -1, error: 'path_traversal' };
  }
  if (!fs.existsSync(scriptPath)) return { stdout: '', stderr: 'Script not found', exitCode: -1, error: 'not_found' };
  if (!isScriptApproved(noteId, scriptName)) return { stdout: '', stderr: 'Script not approved', exitCode: -1, error: 'not_approved' };

  const envConfig = _loadScriptEnv(noteId);
  const cmdArgs = resolveInterpreter(scriptPath, envConfig);
  const bin = cmdArgs.shift();
  const finalArgs = [...cmdArgs, ...(args || [])];

  const runId = _nextRunId++;

  return new Promise((resolve) => {
    const child = spawn(bin, finalArgs, {
      cwd: dir,
      env: _buildScriptEnv(noteId, envConfig),
    });

    const entry = { noteId, scriptName, startedAt: Date.now(), process: child, stdout: '', stderr: '' };
    _runningScripts.set(runId, entry);
    _notifyScriptsRunChanged();

    child.stdout.on('data', (chunk) => { entry.stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { entry.stderr += chunk.toString(); });

    child.on('close', (code) => {
      _runningScripts.delete(runId);
      _notifyScriptsRunChanged();
      // Auto-log script output to scripts/logs/{scriptName}.log
      const logsDir = _loggingEnabled ? noteScriptsLogsDir(noteId) : null;
      if (logsDir) {
        try {
          fs.mkdirSync(logsDir, { recursive: true });
          const logFile = path.join(logsDir, scriptName + '.log');
          const header = `\n--- ${new Date().toISOString()} (exit ${code ?? -1}) ---\n`;
          const content = entry.stdout + (entry.stderr ? '\n[stderr]\n' + entry.stderr : '');
          fs.appendFileSync(logFile, header + content + '\n');
          _rotateLogFile(logFile, 500 * 1024);
        } catch {}
      }
      // Detect missing modules on failure
      if (code !== 0 && entry.stderr) {
        const hint = _detectMissingModule(entry.stderr);
        if (hint) _notifyMissingModule(noteId, scriptName, hint);
      }
      resolve({ stdout: entry.stdout, stderr: entry.stderr, exitCode: code ?? -1 });
    });

    child.on('error', (err) => {
      _runningScripts.delete(runId);
      _notifyScriptsRunChanged();
      const hint = _detectMissingModule(err.message);
      if (hint) _notifyMissingModule(noteId, scriptName, hint);
      resolve({ stdout: entry.stdout, stderr: err.message, exitCode: -1, error: 'exec_error' });
    });
  });
});

// --- Per-note script environment config ---

const SCRIPT_ENV_KEY = '__scriptEnv';

function _loadScriptEnv(noteId) {
  if (!workspacePath) return null;
  const data = noteDb.noteDbLoad(workspacePath, noteId);
  return data[SCRIPT_ENV_KEY] || null;
}

ipcMain.handle('note-scripts:get-env', (_e, noteId) => {
  if (!workspacePath || typeof noteId !== 'string' || !noteId) return null;
  return _loadScriptEnv(noteId);
});

ipcMain.handle('note-scripts:set-env', (_e, noteId, config) => {
  if (!workspacePath || typeof noteId !== 'string' || !noteId) throw new Error('Invalid noteId');
  const data = noteDb.noteDbLoad(workspacePath, noteId);
  if (config === null || config === undefined) {
    delete data[SCRIPT_ENV_KEY];
  } else {
    if (typeof config !== 'object') throw new Error('Config must be an object');
    const sanitized = {};
    if (typeof config.pythonPath === 'string') sanitized.pythonPath = config.pythonPath;
    if (typeof config.type === 'string') sanitized.type = config.type;
    data[SCRIPT_ENV_KEY] = sanitized;
  }
  noteDb.noteDbFlush(workspacePath, noteId, data);
  return true;
});

ipcMain.handle('note-scripts:detect-env', (_e, noteId) => {
  if (!workspacePath || typeof noteId !== 'string' || !noteId) return { detected: [] };
  const dir = noteScriptsDir(noteId);
  if (!dir) return { detected: [] };
  const detected = [];
  // Check for .venv in scripts/
  const venvPython = path.join(dir, '.venv', 'bin', 'python3');
  if (fs.existsSync(venvPython)) {
    detected.push({ type: 'venv', label: 'scripts/.venv', pythonPath: venvPython });
  }
  // Check for .venv in note root
  const noteDir = path.resolve(path.join(workspacePath, noteId));
  const rootVenvPython = path.join(noteDir, '.venv', 'bin', 'python3');
  if (rootVenvPython !== venvPython && fs.existsSync(rootVenvPython)) {
    detected.push({ type: 'venv', label: '.venv', pythonPath: rootVenvPython });
  }
  // Resolve system default python info
  let systemDefault = { name: 'System default' };
  if (process.env.VIRTUAL_ENV) {
    systemDefault.name = path.basename(process.env.VIRTUAL_ENV);
    systemDefault.venv = process.env.VIRTUAL_ENV;
  } else if (process.env.CONDA_DEFAULT_ENV && process.env.CONDA_DEFAULT_ENV !== 'base') {
    systemDefault.name = process.env.CONDA_DEFAULT_ENV;
    systemDefault.conda = true;
  }
  return { detected, systemDefault };
});

// --- Note logging (frontend + script logs) ---

let _loggingEnabled = true; // global toggle, default on

function _loggingEnabledPath() {
  if (!workspacePath) return null;
  return path.join(workspacePath, '.notes-app', 'logging-enabled.json');
}

function _loadLoggingEnabled() {
  const p = _loggingEnabledPath();
  if (!p) { _loggingEnabled = true; return; }
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    _loggingEnabled = data.enabled !== false;
  } catch { _loggingEnabled = true; }
}

function _saveLoggingEnabled() {
  const p = _loggingEnabledPath();
  if (!p) return;
  try {
    const dir = path.dirname(p);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ enabled: _loggingEnabled }));
  } catch {}
}

ipcMain.handle('note-logging:get', () => _loggingEnabled);

ipcMain.handle('note-logging:set', (_e, enabled) => {
  _loggingEnabled = !!enabled;
  _saveLoggingEnabled();
  return _loggingEnabled;
});

ipcMain.handle('note-log:write', (_e, noteId, msg) => {
  if (!_loggingEnabled) return;
  if (!workspacePath) return;
  if (typeof noteId !== 'string' || !noteId) return;
  if (typeof msg !== 'string') return;
  const logsDir = noteScriptsLogsDir(noteId);
  if (!logsDir) return;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const logFile = path.join(logsDir, 'frontend.log');
    const line = `[${new Date().toISOString()}] ${msg.slice(0, 10000)}\n`;
    fs.appendFileSync(logFile, line);
    _rotateLogFile(logFile, 500 * 1024);
  } catch {}
});

ipcMain.handle('note-logs:list', (_e, noteId) => {
  if (!workspacePath) return [];
  if (typeof noteId !== 'string' || !noteId) return [];
  const logsDir = noteScriptsLogsDir(noteId);
  if (!logsDir || !fs.existsSync(logsDir)) return [];
  const entries = [];
  try {
    for (const name of fs.readdirSync(logsDir)) {
      if (!name.endsWith('.log')) continue;
      try {
        const stat = fs.statSync(path.join(logsDir, name));
        if (stat.isFile()) entries.push({ name, size: stat.size, modified: stat.mtime.toISOString() });
      } catch {}
    }
  } catch {}
  return entries;
});

ipcMain.handle('note-logs:read', (_e, noteId, logName) => {
  if (!workspacePath) return '';
  if (typeof noteId !== 'string' || !noteId) return '';
  if (typeof logName !== 'string' || !logName.endsWith('.log')) return '';
  if (!isValidNoteFileName(logName)) return '';
  const logsDir = noteScriptsLogsDir(noteId);
  if (!logsDir) return '';
  const logPath = path.resolve(path.join(logsDir, logName));
  if (!logPath.startsWith(logsDir + path.sep) && logPath !== path.join(logsDir, logName)) return '';
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    return content.length > 100000 ? content.slice(-100000) : content;
  } catch { return ''; }
});

ipcMain.handle('note-logs:clear', (_e, noteId, logName) => {
  if (!workspacePath) return false;
  if (typeof noteId !== 'string' || !noteId) return false;
  if (typeof logName !== 'string' || !logName.endsWith('.log')) return false;
  if (!isValidNoteFileName(logName)) return false;
  const logsDir = noteScriptsLogsDir(noteId);
  if (!logsDir) return false;
  const logPath = path.resolve(path.join(logsDir, logName));
  if (!logPath.startsWith(logsDir + path.sep) && logPath !== path.join(logsDir, logName)) return false;
  try { fs.writeFileSync(logPath, ''); return true; } catch { return false; }
});

ipcMain.handle('note-sql:tables', (_e, noteId) => {
  if (!workspacePath) return [];
  if (typeof noteId !== 'string' || !noteId) return [];
  if (!noteSqlDbPath(noteId)) return [];
  const db = noteSqlOpenReadonly(noteId);
  if (!db) return [];
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  return tables.map(({ name }) => {
    const safeName = `"${name.replace(/"/g, '""')}"`;
    const columns = db.prepare(`PRAGMA table_info(${safeName})`).all()
      .map(col => ({ name: col.name, type: col.type }));
    const rowCount = db.prepare(`SELECT COUNT(*) AS cnt FROM ${safeName}`).get().cnt;
    return { name, columns, rowCount };
  });
});

ipcMain.handle('note-sql:query-readonly', (_e, noteId, sql, params) => {
  if (!workspacePath) throw new Error('No workspace open');
  if (typeof noteId !== 'string' || !noteId) throw new Error('noteId must be a non-empty string');
  if (typeof sql !== 'string' || !sql) throw new Error('sql must be a non-empty string');
  if (params !== undefined && !Array.isArray(params)) throw new Error('params must be an array');
  if (!noteSqlDbPath(noteId)) throw new Error('Invalid noteId (path traversal detected)');
  const trimmedUpper = sql.trimStart().toUpperCase();
  const allowed = ['SELECT', 'WITH', 'EXPLAIN', 'PRAGMA'];
  if (!allowed.some(prefix => trimmedUpper.startsWith(prefix))) {
    throw new Error('Only SELECT queries are allowed');
  }
  const db = noteSqlOpenReadonly(noteId);
  if (!db) return [];
  return db.prepare(sql).all(...(params || []));
});

// --- Export engine (feature 102) ---

ipcMain.handle('export:note', async (_e, notePath, format, options) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };
  const resolved = path.resolve(notePath);
  if (!isInsideWorkspace(resolved)) return { error: 'Path is outside the workspace' };
  try {
    return await exportModule.exportNote(resolved, format, options);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('export:formats', () => {
  return exportModule.getSupportedFormats();
});

// --- PDF export with Save dialog (feature 103) ---

ipcMain.handle('export:save-pdf', async (_e, notePath, options) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };
  const resolved = path.resolve(notePath);
  if (!isInsideWorkspace(resolved)) return { error: 'Path is outside the workspace' };

  _e.sender.send('export:pdf-progress', 'loading');

  let pdfBuffer;
  try {
    const result = await exportModule.exportNote(resolved, 'pdf', {
      notePath: resolved,
      workspacePath,
      ...(options || {}),
    });
    pdfBuffer = result.content;
  } catch (err) {
    return { error: err.message };
  }

  _e.sender.send('export:pdf-progress', 'saving');

  const baseName = path.basename(resolved, path.extname(resolved));
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: path.join(path.dirname(resolved), `${baseName}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (canceled || !filePath) return { cancelled: true };

  try {
    fs.writeFileSync(filePath, pdfBuffer);
  } catch (err) {
    return { error: `Failed to write PDF: ${err.message}` };
  }

  return { success: true, filePath };
});

// --- Markdown export with Save dialog (feature 104) ---

ipcMain.handle('export:save-markdown', async (_e, notePath) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };
  const resolved = path.resolve(notePath);
  if (!isInsideWorkspace(resolved)) return { error: 'Path is outside the workspace' };

  let markdownContent;
  try {
    const result = await exportModule.exportNote(resolved, 'markdown');
    markdownContent = result.content;
  } catch (err) {
    return { error: err.message };
  }

  const baseName = path.basename(resolved, path.extname(resolved));
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: path.join(path.dirname(resolved), `${baseName}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });

  if (canceled || !filePath) return { cancelled: true };

  try {
    fs.writeFileSync(filePath, markdownContent, 'utf-8');
  } catch (err) {
    return { error: `Failed to write Markdown: ${err.message}` };
  }

  return { success: true, filePath };
});

// --- Plain text export with Save dialog (feature 105) ---

ipcMain.handle('export:save-plaintext', async (_e, notePath) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };
  const resolved = path.resolve(notePath);
  if (!isInsideWorkspace(resolved)) return { error: 'Path is outside the workspace' };

  let textContent;
  try {
    const result = await exportModule.exportNote(resolved, 'plaintext');
    textContent = result.content;
  } catch (err) {
    return { error: err.message };
  }

  const baseName = path.basename(resolved, path.extname(resolved));
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: path.join(path.dirname(resolved), `${baseName}.txt`),
    filters: [{ name: 'Plain Text', extensions: ['txt'] }],
  });

  if (canceled || !filePath) return { cancelled: true };

  try {
    fs.writeFileSync(filePath, textContent, 'utf-8');
  } catch (err) {
    return { error: `Failed to write plain text: ${err.message}` };
  }

  return { success: true, filePath };
});

ipcMain.handle('export:save-html', async (_e, notePath) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };
  const resolved = path.resolve(notePath);
  if (!isInsideWorkspace(resolved)) return { error: 'Path is outside the workspace' };

  let htmlContent;
  try {
    const result = await exportModule.exportNote(resolved, 'html');
    htmlContent = result.content;
  } catch (err) {
    return { error: `Conversion failed: ${err.message}` };
  }

  const baseName = path.basename(resolved, '.html');
  const newFilename = baseName + '.html';

  let filePath;
  try {
    const { canceled, filePath: chosenPath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('documents'), newFilename),
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (canceled) return { cancelled: true };
    filePath = chosenPath;
    fs.writeFileSync(filePath, htmlContent, 'utf-8');
  } catch (err) {
    return { error: `Failed to write HTML: ${err.message}` };
  }

  return { success: true, filePath };
});

// --- Bulk export to ZIP (feature 106) ---

let _activeBulkExporter = null;

ipcMain.handle('export:bulk', async (_e, folderPath, format) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (typeof folderPath !== 'string' || !folderPath) return { error: 'folderPath is required' };
  if (typeof format !== 'string' || !format) return { error: 'format is required' };

  const resolved = path.resolve(folderPath);
  if (!isInsideWorkspace(resolved)) return { error: 'Path is outside the workspace' };

  if (_activeBulkExporter) {
    return { error: 'A bulk export is already in progress. Cancel it first.' };
  }

  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const { canceled, filePath: outputPath } = await dialog.showSaveDialog({
    defaultPath: path.join(workspacePath, `notes-export-${dateStr}.zip`),
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
  });

  if (canceled || !outputPath) return { cancelled: true };

  try { _e.sender.send('export:bulk-progress', { processed: 0, total: 0, currentFile: 'Preparing\u2026' }); } catch {}

  return new Promise((resolve) => {
    const exporter = bulkExport(resolved, format, workspacePath, { outputPath });
    _activeBulkExporter = exporter;

    exporter.on('progress', (data) => {
      try { _e.sender.send('export:bulk-progress', data); } catch {}
    });

    exporter.on('done', ({ zipPath }) => {
      _activeBulkExporter = null;
      resolve({ success: true, filePath: zipPath });
    });

    exporter.on('cancelled', () => {
      _activeBulkExporter = null;
      resolve({ cancelled: true });
    });

    exporter.on('error', (err) => {
      _activeBulkExporter = null;
      try { fs.unlinkSync(outputPath); } catch {}
      resolve({ error: err.message });
    });
  });
});

ipcMain.on('export:bulk-cancel', () => {
  if (_activeBulkExporter) {
    _activeBulkExporter.cancel();
  }
});

// --- Inline Note as Single HTML (shared helper) ---

const _INLINE_MIME_MAP = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function inlineNoteAsHtml(noteFolderPath) {
  const indexPath = path.join(noteFolderPath, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  let noteTitle = path.basename(noteFolderPath);
  try {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (match) noteTitle = match[1].trim();
  } catch {}

  function resolveAsset(ref) {
    const decoded = decodeURIComponent(ref.split('?')[0].split('#')[0]);
    const abs = path.resolve(noteFolderPath, decoded);
    if (!abs.startsWith(noteFolderPath + path.sep) && abs !== noteFolderPath) return null;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return abs;
  }

  function toDataUri(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.css') return null;
    const mime = _INLINE_MIME_MAP[ext];
    if (!mime) return null;
    const buf = fs.readFileSync(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  function inlineCssFile(cssPath, visited) {
    if (!visited) visited = new Set();
    if (visited.has(cssPath)) return '';
    visited.add(cssPath);
    let css = fs.readFileSync(cssPath, 'utf8');
    const cssDir = path.dirname(cssPath);
    css = css.replace(/@import\s+(?:url\()?['"]?([^'");\s]+)['"]?\)?[^;]*;/g, (_m, ref) => {
      const abs = path.resolve(cssDir, decodeURIComponent(ref.split('?')[0].split('#')[0]));
      if (!abs.startsWith(noteFolderPath) || !fs.existsSync(abs)) return '';
      return inlineCssFile(abs, visited);
    });
    css = css.replace(/url\(\s*['"]?(?!data:)([^'")]+)['"]?\s*\)/g, (_m, ref) => {
      const abs = path.resolve(cssDir, decodeURIComponent(ref.split('?')[0].split('#')[0]));
      if (!abs.startsWith(noteFolderPath) || !fs.existsSync(abs)) return _m;
      const ext = path.extname(abs).toLowerCase();
      const mime = _INLINE_MIME_MAP[ext];
      if (!mime) return _m;
      const b64 = fs.readFileSync(abs).toString('base64');
      return `url(data:${mime};base64,${b64})`;
    });
    return css;
  }

  function inlineCssUrls(css) {
    return css.replace(/url\(\s*['"]?(?!data:)([^'")]+)['"]?\s*\)/g, (_u, ref) => {
      if (/^https?:\/\//.test(ref)) return _u;
      const abs = resolveAsset(ref);
      if (!abs) return _u;
      const ext = path.extname(abs).toLowerCase();
      const mime = _INLINE_MIME_MAP[ext];
      if (!mime) return _u;
      const b64 = fs.readFileSync(abs).toString('base64');
      return `url(data:${mime};base64,${b64})`;
    });
  }

  // Inline <link rel="stylesheet"> → <style>
  html = html.replace(/<link\s[^>]*rel=["']stylesheet["'][^>]*>/gi, (tag) => {
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) return tag;
    const ref = hrefMatch[1];
    if (/^https?:\/\//.test(ref)) return tag;
    const abs = resolveAsset(ref);
    if (!abs) return tag;
    return `<style>/* inlined: ${ref} */\n${inlineCssFile(abs)}\n</style>`;
  });

  // Inline <script src="..."> → <script>
  html = html.replace(/<script\s[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (_tag, ref) => {
    if (/^https?:\/\//.test(ref)) return _tag;
    const abs = resolveAsset(ref);
    if (!abs) return _tag;
    return `<script>/* inlined: ${ref} */\n${fs.readFileSync(abs, 'utf8')}\n</script>`;
  });

  // Inline <img>, <source>, <audio>, <video> src
  html = html.replace(/(<(?:img|source|audio|video)\s[^>]*)(src=["'])([^"']+)(["'][^>]*>)/gi, (_m, before, attr, ref, after) => {
    if (/^(https?:\/\/|data:)/.test(ref)) return _m;
    const abs = resolveAsset(ref);
    if (!abs) return _m;
    const dataUri = toDataUri(abs);
    if (!dataUri) return _m;
    return `${before}${attr}${dataUri}${after}`;
  });

  // Inline url() in <style> blocks
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open, css, close) => {
    return `${open}${inlineCssUrls(css)}${close}`;
  });

  // Inline url() in style="..." attributes
  html = html.replace(/style=["']([^"']*url\([^)]+\)[^"']*)["']/gi, (_m, styleVal) => {
    return `style="${inlineCssUrls(styleVal)}"`;
  });

  // Ensure UTF-8 charset is declared. Prevents mojibake when the gist is
  // loaded via a blob: iframe or viewed directly on gist.github.com.
  if (!/<meta[^>]+charset\s*=/i.test(html)) {
    const charsetMeta = '<meta charset="utf-8">';
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>\n${charsetMeta}`);
    } else if (/<html[^>]*>/i.test(html)) {
      html = html.replace(/<html([^>]*)>/i, `<html$1>\n<head>${charsetMeta}</head>`);
    } else {
      html = `${charsetMeta}\n${html}`;
    }
  }

  // Inject the note-viewer stylesheet so exported/shared notes match the in-app
  // theme. Placed last in <head> to override author defaults, matching how
  // webview.insertCSS layers it inside the app.
  const styleBlock = `<style data-source="toutkit-share">\n${SHARE_NOTE_CSS}</style>`;
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${styleBlock}\n</head>`);
  } else if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body([^>]*)>/i, `<body$1>\n${styleBlock}`);
  } else {
    html = `${styleBlock}\n${html}`;
  }

  const usesBackendAPIs = /\b(noteDB|noteFiles|noteSQL|noteScripts|noteLog)\b/.test(html);

  return { html, noteTitle, usesBackendAPIs };
}

// --- Export as Single HTML File ---

ipcMain.handle('export:single-html', async (_e, notePath) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };

  const noteFolderPath = path.resolve(notePath);
  if (!isInsideWorkspace(noteFolderPath)) return { error: 'Path is outside the workspace' };

  const indexPath = path.join(noteFolderPath, 'index.html');
  if (!fs.existsSync(indexPath)) return { error: 'Not a valid note (no index.html found)' };

  const { html, noteTitle, usesBackendAPIs } = inlineNoteAsHtml(noteFolderPath);
  const safeTitle = noteTitle.replace(/[/\\:*?"<>|]/g, '-').slice(0, 100) || 'ExportedNote';

  const { canceled, filePath: destPath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('desktop'), `${safeTitle}.html`),
    filters: [{ name: 'HTML File', extensions: ['html'] }],
    message: usesBackendAPIs
      ? `"${noteTitle}" uses backend APIs (noteDB/noteSQL/etc.) that won't work in a browser.`
      : `Export "${noteTitle}" as a single HTML file`,
  });
  if (canceled || !destPath) return { cancelled: true };

  try {
    fs.writeFileSync(destPath, html, 'utf8');
    return { success: true, filePath: destPath, title: noteTitle, usesBackendAPIs };
  } catch (err) {
    return { error: `Export failed: ${err.message}` };
  }
});

// --- Publish / Unpublish Note via GitHub Gist + Pages ---

// Gist visibility cannot be changed in place — the gist must be recreated to
// switch between secret and public. ~10 MB is GitHub's hard cap on a gist;
// 1 MB is the practical limit before the web UI degrades.
const SHARE_GIST_BYTES_WARN = 1024 * 1024;
const SHARE_GIST_BYTES_HARD_CAP = 10 * 1024 * 1024;

ipcMain.handle('export:publish', async (_e, notePath, options = {}) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };

  if (!github.isConnected()) {
    return { error: 'github-not-connected', message: 'Connect GitHub to share notes.' };
  }

  // Phase 5 UI passes options.repoName on the user's first publish.
  if (options && options.repoName && !github.getRepoName()) {
    try { github.setRepoName(options.repoName); }
    catch (err) { return { error: err.message || String(err) }; }
  }
  const repoName = github.getRepoName();
  if (!repoName) {
    return { error: 'github-no-repo-name', message: 'Pick a repo name to host your shares.' };
  }

  const noteFolderPath = path.resolve(notePath);
  if (!isInsideWorkspace(noteFolderPath)) return { error: 'Path is outside the workspace' };

  const indexPath = path.join(noteFolderPath, 'index.html');
  if (!fs.existsSync(indexPath)) return { error: 'Not a valid note (no index.html found)' };

  const { html, noteTitle, usesBackendAPIs } = inlineNoteAsHtml(noteFolderPath);
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  if (htmlBytes > SHARE_GIST_BYTES_HARD_CAP) {
    return { error: `Note is too large to share via GitHub (${(htmlBytes / 1024 / 1024).toFixed(1)} MB > 10 MB).` };
  }

  const noteId = path.relative(workspacePath, noteFolderPath);
  const kvData = noteDb.noteDbLoad(workspacePath, noteId);

  const githubApi = require('./github-api');
  const visibility = options && options.visibility === 'public' ? 'public' : 'secret';
  const isPublic = visibility === 'public';

  try {
    const provision = await githubApi.ensureRepoProvisioned(repoName, shareRenderer.getRenderer());

    const looksLikeGistId = (s) => typeof s === 'string' && /^[a-f0-9]{20,40}$/i.test(s);
    const oldId = kvData.__shareId || null;
    const oldVisibility = kvData.__shareVisibility || null;
    let gistId = null;

    if (looksLikeGistId(oldId) && oldVisibility === visibility) {
      try {
        await githubApi.updateGist(oldId, html);
        gistId = oldId;
      } catch {
        gistId = null; // gist gone or inaccessible — fall through to create
      }
    } else if (looksLikeGistId(oldId) && oldVisibility && oldVisibility !== visibility) {
      // Visibility changed → can't mutate; replace.
      try { await githubApi.deleteGist(oldId); } catch {}
    }

    if (!gistId) {
      const created = await githubApi.createGist({ html, isPublic });
      gistId = created.id;
    }

    // First-publish path: Pages 404s for ~30–60 s during the initial build.
    // Wait for it before returning the URL so the user never gets a dead link.
    if (provision.firstProvision) {
      try { await githubApi.waitForPagesBuilt(repoName); } catch {}
    }

    const shareUrl = githubApi.pagesUrl(repoName, gistId);
    kvData.__shareId = gistId;
    kvData.__shareUrl = shareUrl;
    kvData.__shareVisibility = visibility;
    noteDb.noteDbFlush(workspacePath, noteId, kvData);

    const sizeWarning = htmlBytes > SHARE_GIST_BYTES_WARN
      ? ` (${(htmlBytes / 1024 / 1024).toFixed(1)} MB — close to GitHub's 10 MB limit)`
      : '';

    return {
      success: true,
      shareUrl,
      shareId: gistId,
      title: noteTitle,
      usesBackendAPIs,
      visibility,
      sizeWarning,
      firstProvision: !!provision.firstProvision,
    };
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

ipcMain.handle('export:unpublish', async (_e, notePath) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };

  if (!github.isConnected()) return { error: 'Not connected to GitHub.' };

  const noteFolderPath = path.resolve(notePath);
  if (!isInsideWorkspace(noteFolderPath)) return { error: 'Path is outside the workspace' };

  const noteId = path.relative(workspacePath, noteFolderPath);
  const kvData = noteDb.noteDbLoad(workspacePath, noteId);
  const shareId = kvData.__shareId;
  if (!shareId) return { error: 'This note is not published.' };

  try {
    const githubApi = require('./github-api');
    await githubApi.deleteGist(shareId);
  } catch (err) {
    return { error: err.message || String(err) };
  }

  delete kvData.__shareId;
  delete kvData.__shareUrl;
  delete kvData.__shareVisibility;
  noteDb.noteDbFlush(workspacePath, noteId, kvData);

  return { success: true };
});

// Walk the workspace, return { [absoluteNotePath]: { shareId, shareUrl, visibility } }
// for every note whose kv.json has __shareId set. Local truth — does not verify
// that the gist still exists on GitHub.
ipcMain.handle('notes:listPublished', () => {
  if (!workspacePath) return {};
  const results = {};

  function walk(dirPath) {
    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (fs.existsSync(path.join(fullPath, 'index.html'))) {
        const noteId = path.relative(workspacePath, fullPath);
        const kv = noteDb.noteDbLoad(workspacePath, noteId);
        if (kv && kv.__shareId) {
          results[fullPath] = {
            shareId: kv.__shareId,
            shareUrl: kv.__shareUrl || null,
            visibility: kv.__shareVisibility || 'secret',
          };
        }
      } else {
        walk(fullPath);
      }
    }
  }

  walk(workspacePath);
  return results;
});

// --- Export as Standalone Electron App ---

ipcMain.handle('export:standalone', async (_e, notePath) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (typeof notePath !== 'string' || !notePath) return { error: 'notePath is required' };

  const noteFolderPath = path.resolve(notePath);
  if (!isInsideWorkspace(noteFolderPath)) return { error: 'Path is outside the workspace' };

  // Validate note folder
  const indexPath = path.join(noteFolderPath, 'index.html');
  if (!fs.existsSync(indexPath)) return { error: 'Not a valid note (no index.html found)' };

  // Locate the pre-built template skeleton. In packaged builds the prebuilt
  // .app ships via electron-builder's `extraResources` (kept out of app.asar
  // so framework symlinks survive); in dev it lives next to the source.
  const templateAppName = 'ExportedNote.app';
  const templateDir = app.isPackaged
    ? path.join(process.resourcesPath, 'export-template')
    : path.join(__dirname, 'export-app-template', 'prebuilt', 'ExportedNote-darwin-arm64');
  const templateApp = path.join(templateDir, templateAppName);
  if (!fs.existsSync(templateApp)) {
    return { error: 'Export template not built. Run: node scripts/build-export-template.js' };
  }

  // Extract note title from index.html <title> tag
  let noteTitle = path.basename(noteFolderPath);
  try {
    const html = fs.readFileSync(indexPath, 'utf8');
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (match) noteTitle = match[1].trim();
  } catch {}

  // Sanitize title for filesystem
  const safeTitle = noteTitle.replace(/[/\\:*?"<>|]/g, '-').slice(0, 100) || 'ExportedNote';

  // Show Save dialog
  const { canceled, filePath: destPath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('desktop'), `${safeTitle}.app`),
    message: `Export "${noteTitle}" as a standalone app (~200 MB)`,
  });
  if (canceled || !destPath) return { cancelled: true };

  // Notify progress
  try { _e.sender.send('export:standalone-progress', 'copying'); } catch {}

  const tmpDir = path.join(app.getPath('temp'), `note-export-${Date.now()}`);
  const tmpApp = path.join(tmpDir, `${safeTitle}.app`);

  try {
    // Copy template skeleton (cp -a preserves relative symlinks in frameworks)
    fs.mkdirSync(tmpDir, { recursive: true });
    execFileSync('cp', ['-a', templateApp, tmpApp]);

    // Keep internal binary names as "ExportedNote" — Electron helpers must match
    // the main binary name. Only the outer .app folder gets renamed (via tmpApp).
    // The display name is set via Info.plist CFBundleDisplayName.

    // Inject the note folder into Resources/note/
    const resourcesDir = path.join(tmpApp, 'Contents', 'Resources');
    const noteDestDir = path.join(resourcesDir, 'note');
    fs.cpSync(noteFolderPath, noteDestDir, {
      recursive: true,
      filter: (src) => !src.split(path.sep).includes('.notes-app'),
    });

    // Write config.json
    fs.writeFileSync(
      path.join(resourcesDir, 'config.json'),
      JSON.stringify({ noteId: 'note', title: noteTitle }, null, 2)
    );

    // Update Info.plist — only set CFBundleDisplayName (shown in Dock/Finder).
    // Do NOT change CFBundleName or CFBundleExecutable — Electron uses
    // CFBundleName to locate helper apps, so it must stay "ExportedNote".
    const plistPath = path.join(tmpApp, 'Contents', 'Info.plist');
    if (fs.existsSync(plistPath)) {
      let plist = fs.readFileSync(plistPath, 'utf8');
      if (!plist.includes('CFBundleDisplayName')) {
        plist = plist.replace(
          /(<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>)/,
          `$1\n\t<key>CFBundleDisplayName</key>\n\t<string>${noteTitle}</string>`
        );
      } else {
        plist = plist.replace(
          /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*/,
          `$1${noteTitle}`
        );
      }
      fs.writeFileSync(plistPath, plist);
    }

    // Ad-hoc codesign (inside-out: helpers → frameworks → outer app)
    try { _e.sender.send('export:standalone-progress', 'signing'); } catch {}
    try {
      const fwPath = path.join(tmpApp, 'Contents', 'Frameworks');
      const entries = fs.readdirSync(fwPath);
      // 1. Sign helper apps
      for (const e of entries.filter(f => f.endsWith('.app'))) {
        execFileSync('codesign', ['--force', '--sign', '-', path.join(fwPath, e)]);
      }
      // 2. Sign frameworks
      for (const e of entries.filter(f => f.endsWith('.framework'))) {
        execFileSync('codesign', ['--force', '--sign', '-', path.join(fwPath, e)]);
      }
      // 3. Sign outer app
      execFileSync('codesign', ['--force', '--sign', '-', tmpApp]);
    } catch {
      // Non-fatal — app will work, just with Gatekeeper warning
    }

    // Move to final destination (remove existing if present)
    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true });
    }
    fs.renameSync(tmpApp, destPath);

    return { success: true, filePath: destPath, title: noteTitle };
  } catch (err) {
    return { error: `Export failed: ${err.message}` };
  } finally {
    // Clean up temp dir
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
});

// --- Export Standalone App Source Code ---

ipcMain.handle('export:standalone-source', async (_e, notePath_) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (typeof notePath_ !== 'string' || !notePath_) return { error: 'notePath is required' };

  const noteFolderPath = path.resolve(notePath_);
  if (!isInsideWorkspace(noteFolderPath)) return { error: 'Path is outside the workspace' };

  const indexPath = path.join(noteFolderPath, 'index.html');
  if (!fs.existsSync(indexPath)) return { error: 'Not a valid note (no index.html found)' };

  // Extract note title
  let noteTitle = path.basename(noteFolderPath);
  try {
    const html = fs.readFileSync(indexPath, 'utf8');
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (match) noteTitle = match[1].trim();
  } catch {}

  const safeTitle = noteTitle.replace(/[/\\:*?"<>|]/g, '-').slice(0, 100) || 'ExportedNote';

  // Show folder picker
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: `Choose folder for "${noteTitle}" source code`,
    defaultPath: path.join(app.getPath('desktop'), `${safeTitle}-source`),
    properties: ['createDirectory', 'openDirectory'],
  });
  if (canceled || !filePaths.length) return { cancelled: true };

  const destDir = path.join(filePaths[0], `${safeTitle}-source`);

  try {
    fs.mkdirSync(destDir, { recursive: true });

    // Copy template source files. Packaged builds ship them via
    // electron-builder's `extraResources`; in dev they live in the repo.
    const templateSourceDir = app.isPackaged
      ? path.join(process.resourcesPath, 'export-template-source')
      : path.join(__dirname, 'export-app-template');
    const sourceFiles = ['main.js', 'preload.js', 'note-db.js'];
    for (const file of sourceFiles) {
      const src = path.join(templateSourceDir, file);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(destDir, file));
    }

    // Copy note-viewer.css
    const cssPath = path.join(__dirname, 'note-viewer.css');
    if (fs.existsSync(cssPath)) fs.copyFileSync(cssPath, path.join(destDir, 'note-viewer.css'));

    // Copy the note folder into note/
    const noteDestDir = path.join(destDir, 'note');
    fs.cpSync(noteFolderPath, noteDestDir, {
      recursive: true,
      filter: (src) => !src.split(path.sep).includes('.notes-app'),
    });

    // Write config.json
    fs.writeFileSync(
      path.join(destDir, 'config.json'),
      JSON.stringify({ noteId: 'note', title: noteTitle }, null, 2)
    );

    // Write package.json with build scripts
    const electronVersion = process.versions.electron;
    const pkgJson = {
      name: safeTitle.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      version: '1.0.0',
      main: 'main.js',
      scripts: {
        start: 'electron .',
        build: 'electron-packager . --overwrite --out=dist',
      },
      dependencies: {
        'better-sqlite3': '^11.10.0',
      },
      devDependencies: {
        electron: `^${electronVersion}`,
        'electron-packager': '^17.1.2',
        '@electron/rebuild': '^3.7.1',
      },
    };
    fs.writeFileSync(path.join(destDir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n');

    // Write README
    const readme = `# ${noteTitle}

Standalone Electron app exported from toutkit.

## Quick Start

\`\`\`bash
npm install
npx @electron/rebuild   # rebuild native modules for Electron
npm start               # run the app
\`\`\`

## Build a Distributable .app

\`\`\`bash
npm run build
\`\`\`

The packaged app will be in the \`dist/\` folder.

## Project Structure

- \`main.js\` — Electron main process (window, IPC handlers, note:// protocol)
- \`preload.js\` — Preload script (exposes noteDB, noteFiles, noteSQL, noteScripts APIs)
- \`note-db.js\` — Key-value storage helper (JSON-based)
- \`note-viewer.css\` — Injected stylesheet for the note viewer
- \`config.json\` — App configuration (title, noteId)
- \`note/\` — Your note content (index.html and assets)

## Customizing

Edit any file and run \`npm start\` to see changes. The note content is in \`note/\`.
During development, the app reads from the local \`note/\` directory. When packaged,
it reads from the app's resources directory.
`;
    fs.writeFileSync(path.join(destDir, 'README.md'), readme);

    return { success: true, filePath: destDir, title: noteTitle };
  } catch (err) {
    return { error: `Export failed: ${err.message}` };
  }
});

// --- Markdown Import (feature 107) ---

ipcMain.handle('import:browse-markdown', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths;
});

ipcMain.handle('import:markdown', async (_e, filePaths, targetDir, mode) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (!Array.isArray(filePaths) || filePaths.length === 0) return { error: 'No files specified' };
  if (typeof targetDir !== 'string' || !targetDir) return { error: 'targetDir is required' };
  if (mode !== 'html' && mode !== 'markdown') return { error: 'mode must be "html" or "markdown"' };

  const resolvedTarget = path.resolve(targetDir);
  if (!isInsideWorkspace(resolvedTarget)) return { error: 'Target folder is outside workspace' };

  // Ensure target directory exists (it should, but guard against race conditions)
  try {
    await fs.promises.mkdir(resolvedTarget, { recursive: true });
  } catch {}

  return importMarkdownFiles(filePaths, resolvedTarget, mode, NOTE_CSS);
});

// --- Plain Text Import (feature 108) ---

ipcMain.handle('import:browse-plaintext', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths;
});

ipcMain.handle('import:plaintext', async (_e, filePaths, targetDir, mode) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (!Array.isArray(filePaths) || filePaths.length === 0) return { error: 'No files specified' };
  if (typeof targetDir !== 'string' || !targetDir) return { error: 'targetDir is required' };
  if (mode !== 'pre' && mode !== 'p' && mode !== 'txt') return { error: 'mode must be "pre", "p", or "txt"' };

  const resolvedTarget = path.resolve(targetDir);
  if (!isInsideWorkspace(resolvedTarget)) return { error: 'Target folder is outside workspace' };

  // Ensure target directory exists (guard against race conditions)
  try {
    await fs.promises.mkdir(resolvedTarget, { recursive: true });
  } catch {}

  return importPlaintextFiles(filePaths, resolvedTarget, mode, NOTE_CSS);
});

// --- Batch Import (feature 109) ---

let activeBatchImporter = null;

ipcMain.handle('import:batch-scan-folder', async (_e, folderPath) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (typeof folderPath !== 'string' || !folderPath) return { error: 'folderPath is required' };

  let stat;
  try { stat = fs.statSync(folderPath); } catch { return { error: 'Folder not found' }; }
  if (!stat.isDirectory()) return { error: 'Path is not a directory' };

  return scanFolder(folderPath);
});

ipcMain.handle('import:batch-scan-files', async (_e, filePaths) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (!Array.isArray(filePaths) || filePaths.length === 0) return { error: 'No files specified' };

  return scanFiles(filePaths);
});

ipcMain.handle('import:batch-browse-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('import:batch-execute', async (e, files, targetDir) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (!Array.isArray(files) || files.length === 0) return { error: 'No files specified' };
  if (typeof targetDir !== 'string' || !targetDir) return { error: 'targetDir is required' };

  const resolvedTarget = path.resolve(targetDir);
  if (!isInsideWorkspace(resolvedTarget)) return { error: 'Target folder is outside workspace' };

  if (activeBatchImporter) return { error: 'A batch import is already in progress' };

  return new Promise((resolve) => {
    const importer = executeBatchImport(files, resolvedTarget, NOTE_CSS);
    activeBatchImporter = importer;

    importer.on('progress', (data) => {
      e.sender.send('import:batch-progress', data);
    });

    importer.on('done', (results) => {
      activeBatchImporter = null;
      resolve(results);
    });

    importer.on('cancelled', (results) => {
      activeBatchImporter = null;
      resolve({ ...results, cancelled: true });
    });

    importer.on('error', (err) => {
      activeBatchImporter = null;
      resolve({ error: err.message });
    });
  });
});

ipcMain.on('import:batch-cancel', () => {
  if (activeBatchImporter) activeBatchImporter.cancel();
});

// ─── Web Clip ─────────────────────────────────────────────────────────────────

const { clipFromUrl } = require('./web-clip');

ipcMain.handle('clip:from-url', async (_e, url, targetDir) => {
  if (!workspacePath) return { error: 'No workspace open' };
  if (typeof url !== 'string' || !url) return { error: 'URL is required' };
  if (typeof targetDir !== 'string' || !targetDir) return { error: 'targetDir is required' };

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'Only http and https URLs are supported' };
    }
  } catch {
    return { error: 'Invalid URL' };
  }

  const resolvedTarget = path.resolve(targetDir);
  if (!isInsideWorkspace(resolvedTarget)) return { error: 'Target folder is outside workspace' };

  try {
    await fs.promises.mkdir(resolvedTarget, { recursive: true });
  } catch {}

  return clipFromUrl(url, resolvedTarget, NOTE_CSS);
});

// ─── Auth (feature 141) ───────────────────────────────────────────────────────

ipcMain.handle('auth:login', async () => {
  auth.login();
});

ipcMain.handle('auth:signup', async () => {
  auth.signup();
});

ipcMain.handle('auth:logout', async () => {
  await auth.logout();
});

ipcMain.handle('auth:getUser', () => {
  return auth.getUser();
});

ipcMain.handle('auth:isLoggedIn', () => {
  return auth.isLoggedIn();
});

ipcMain.handle('auth:getAccessToken', async () => {
  return await auth.getAccessToken();
});

ipcMain.handle('auth:isEncryptionUnavailable', () => {
  return auth.isEncryptionUnavailable();
});

// ─── GitHub (gist-backed sharing) ────────────────────────────────────────────

ipcMain.handle('github:connect', async () => {
  try {
    const info = await github.startConnect();
    return { ok: true, data: info };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('github:cancelConnect', () => {
  github.cancelConnect();
  return { ok: true };
});

ipcMain.handle('github:disconnect', () => {
  github.disconnect();
  return { ok: true };
});

ipcMain.handle('github:getState', () => {
  return github.getState();
});

ipcMain.handle('github:setRepoName', (_e, name) => {
  try {
    github.setRepoName(name);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('github:checkRepoName', async (_e, name) => {
  if (!github.isConnected()) return { ok: false, message: 'Not connected to GitHub.' };
  const githubApi = require('./github-api');
  return await githubApi.checkRepoName(name);
});

// Provision the user's *-shares repo right now (without publishing a note).
// Used by the "Create now" choice in Settings → Sharing → Change… so users
// can front-load the ~30 s first-time setup before they actually share.
ipcMain.handle('github:provisionRepo', async () => {
  if (!github.isConnected()) return { ok: false, error: 'Not connected to GitHub.' };
  const repoName = github.getRepoName();
  if (!repoName) return { ok: false, error: 'No repo name set.' };
  try {
    const githubApi = require('./github-api');
    const provision = await githubApi.ensureRepoProvisioned(repoName, shareRenderer.getRenderer());
    if (provision.firstProvision) {
      try { await githubApi.waitForPagesBuilt(repoName); } catch {}
    }
    const u = github.getUser();
    return {
      ok: true,
      firstProvision: !!provision.firstProvision,
      repoUrl: `https://github.com/${u.login}/${repoName}`,
      pagesUrl: `https://${u.login}.github.io/${repoName}/`,
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// ─── AWS Content Sync IPC handlers (feature 143) ─────────────────────────────

ipcMain.handle('aws-sync:getContentStatus', () => {
  if (!workspacePath) return { ok: false, error: 'no-workspace' };
  return { ok: true, data: syncManager.getStatus().content };
});

ipcMain.handle('aws-sync:syncContentNow', async () => {
  if (!workspacePath) return { ok: false, error: 'no-workspace' };
  if (!auth.isLoggedIn()) return { ok: false, error: 'not-authenticated' };
  await syncManager.syncNow();
  return syncManager.getStatus().content;
});

ipcMain.handle('aws-sync:getConflicts', () => {
  if (!workspacePath) return { ok: false, error: 'no-workspace' };
  const conflicts = _findConflictFiles(workspacePath);
  return { ok: true, data: { conflicts } };
});

ipcMain.handle('aws-sync:getConflictDetails', (_e, conflictRelPath) => {
  if (!workspacePath) return { ok: false, error: 'no-workspace' };
  const match = conflictRelPath.match(/^(.+)\.conflict\.\d+(\.\w+)?$/);
  if (!match) return { ok: false, error: 'invalid-conflict-path' };
  const localRelPath = match[1] + (match[2] || '');
  const localAbs = path.join(workspacePath, localRelPath);
  const conflictAbs = path.join(workspacePath, conflictRelPath);

  let localContent = '', remoteContent = '';
  let localStat = null, remoteStat = null;
  try { localContent = fs.readFileSync(localAbs, 'utf-8'); } catch {}
  try { remoteContent = fs.readFileSync(conflictAbs, 'utf-8'); } catch {}
  try { localStat = fs.statSync(localAbs); } catch {}
  try { remoteStat = fs.statSync(conflictAbs); } catch {}

  return {
    ok: true,
    data: {
      localRelPath,
      conflictRelPath,
      localContent,
      remoteContent,
      localMtime: localStat ? localStat.mtimeMs : null,
      remoteMtime: remoteStat ? remoteStat.mtimeMs : null,
      localSize: localStat ? localStat.size : 0,
      remoteSize: remoteStat ? remoteStat.size : 0,
    },
  };
});

ipcMain.handle('aws-sync:resolveConflict', async (_event, relPath, choice) => {
  // choice: 'keep-local' | 'keep-remote' | 'keep-both'
  if (!workspacePath) return { ok: false, error: 'no-workspace' };
  return _resolveAwsConflict(relPath, choice);
});

function _findConflictFiles(wsPath) {
  const conflicts = [];
  const pattern = /\.conflict\.\d+(\.\w+)?$/;
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && pattern.test(e.name)) {
        conflicts.push(path.relative(wsPath, abs).replace(/\\/g, '/'));
      }
    }
  }
  walk(wsPath);
  return conflicts;
}

async function _resolveAwsConflict(conflictRelPath, choice) {
  const match = conflictRelPath.match(/^(.+)\.conflict\.\d+(\.\w+)?$/);
  if (!match) return { ok: false, error: 'invalid-conflict-path' };
  const localRelPath = match[1] + (match[2] || '');
  const localAbs = path.join(workspacePath, localRelPath);
  const conflictAbs = path.join(workspacePath, conflictRelPath);

  if (choice === 'keep-local') {
    try { fs.unlinkSync(conflictAbs); } catch {}
    await syncManager.pushFile(localRelPath).catch(() => {});
    return { ok: true };
  }
  if (choice === 'keep-remote') {
    try {
      fs.copyFileSync(conflictAbs, localAbs);
      fs.unlinkSync(conflictAbs);
      await syncManager.pushFile(localRelPath).catch(() => {});
    } catch (err) { return { ok: false, error: err.message }; }
    return { ok: true };
  }
  if (choice === 'keep-both') {
    const ts = Date.now();
    const ext = path.extname(localRelPath);
    const base = localRelPath.slice(0, localRelPath.length - ext.length);
    const newName = `${base}-remote-${ts}${ext}`;
    try {
      fs.renameSync(conflictAbs, path.join(workspacePath, newName));
      await syncManager.pushFile(newName).catch(() => {});
    } catch (err) { return { ok: false, error: err.message }; }
    return { ok: true };
  }
  return { ok: false, error: 'unknown-choice' };
}
