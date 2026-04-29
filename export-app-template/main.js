'use strict';

const { app, BrowserWindow, ipcMain, protocol, dialog, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const Database = require('better-sqlite3');
const noteDb = require('./note-db');

// ─── Shell environment resolution ────────────────────────────────────────────
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
      if (key === '_' || key === 'SHLVL' || key === 'PWD' || key === 'OLDPWD') continue;
      process.env[key] = val;
    }
  } catch {}
}

// ─── Paths ────────────────────────────────────────────────────────────────────
// The note folder lives inside the app's resources directory when packaged,
// or in the project directory when running from source (npm start).
const notePath = fs.existsSync(path.join(__dirname, 'note'))
  ? path.join(__dirname, 'note')
  : path.join(process.resourcesPath, 'note');
const noteId = 'note';

// Load config written at export time
let config = {};
try {
  const configPath = fs.existsSync(path.join(__dirname, 'config.json'))
    ? path.join(__dirname, 'config.json')
    : path.join(process.resourcesPath, 'config.json');
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {}

const NOTE_CSS = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, 'note-viewer.css'), 'utf8');
  } catch { return ''; }
})();

// ─── note:// protocol ─────────────────────────────────────────────────────────
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

// ─── MIME types ───────────────────────────────────────────────────────────────
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.xml': 'application/xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.pdf': 'application/pdf',
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function noteFilesDir() {
  return path.join(notePath, 'storage', 'files');
}

function noteScriptsDir() {
  return path.join(notePath, 'scripts');
}

function noteScriptsLogsDir() {
  return path.join(notePath, 'scripts', 'logs');
}

function noteSqlDbPath() {
  return path.join(notePath, 'storage', 'db.sqlite');
}

function isValidNoteFileName(name) {
  if (typeof name !== 'string' || !name) return false;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  return true;
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

function _loadScriptEnv() {
  const data = noteDb.noteDbLoad(path.dirname(notePath), noteId);
  return data.__scriptEnv || null;
}

function _buildScriptEnv(envConfig) {
  const env = { ...process.env, NOTE_ID: noteId, NOTE_PATH: notePath, WORKSPACE_PATH: path.dirname(notePath) };
  if (envConfig && envConfig.pythonPath) {
    const venvBin = path.dirname(envConfig.pythonPath);
    env.PATH = venvBin + path.delimiter + (env.PATH || '');
    env.VIRTUAL_ENV = path.dirname(venvBin);
  }
  return env;
}

// ─── SQLite ───────────────────────────────────────────────────────────────────
let sqliteDb = null;
let sqliteDbReadonly = null;

function noteSqlOpen() {
  if (sqliteDb) return sqliteDb;
  const dbPath = noteSqlDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  sqliteDb = db;
  return db;
}

function noteSqlOpenReadonly() {
  if (sqliteDbReadonly) return sqliteDbReadonly;
  const dbPath = noteSqlDbPath();
  if (!fs.existsSync(dbPath)) return null;
  sqliteDbReadonly = new Database(dbPath, { readonly: true });
  return sqliteDbReadonly;
}

// ─── Log rotation ─────────────────────────────────────────────────────────────
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

// ─── Missing module detection ────────────────────────────────────────────────
const _importToPackage = {
  PIL: 'Pillow', cv2: 'opencv-python', sklearn: 'scikit-learn',
  yaml: 'pyyaml', bs4: 'beautifulsoup4', attr: 'attrs',
  dotenv: 'python-dotenv', serial: 'pyserial',
  Crypto: 'pycryptodome', jwt: 'PyJWT',
  docx: 'python-docx', pptx: 'python-pptx',
};

function _detectMissingModule(stderr) {
  let m = stderr.match(/ModuleNotFoundError: No module named '([^'.]+)'/);
  if (m) {
    const mod = m[1];
    return { lang: 'python', module: mod, install: `pip install ${_importToPackage[mod] || mod}` };
  }
  m = stderr.match(/Cannot find module '([^']+)'/);
  if (m && !m[1].startsWith('.') && !m[1].startsWith('/')) {
    return { lang: 'node', module: m[1], install: `npm install ${m[1]}` };
  }
  m = stderr.match(/cannot load such file -- (\S+)/);
  if (m) {
    return { lang: 'ruby', module: m[1], install: `gem install ${m[1]}` };
  }
  return null;
}

// ─── Script tracking ──────────────────────────────────────────────────────────
const _runningScripts = new Map();
let _nextRunId = 1;
let mainWindow = null;

function _notifyScriptsRunChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scripts:runChanged');
  }
}

// ─── App ready ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  fixShellEnv();

  // Register note:// protocol handler — serves files from the note folder
  protocol.handle('note', (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Invalid URL', { status: 400, headers: { 'Content-Type': 'text/plain' } });
    }

    if (url.hostname === 'notes') {
      const relativePath = decodeURIComponent(url.pathname);
      const segments = relativePath.split('/');
      if (segments.includes('..')) {
        return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
      }
      // Strip the noteId prefix from the path since everything is under notePath
      // In main app: note://notes/<noteId>/index.html → workspace/<noteId>/index.html
      // In exported app: note://notes/note/index.html → resources/note/index.html
      // We need to strip the first path segment (the noteId) since notePath already points to the note
      const pathParts = relativePath.replace(/^\//, '').split('/');
      pathParts.shift(); // remove noteId segment
      const resolvedPath = path.resolve(path.join(notePath, pathParts.join('/')));

      if (!resolvedPath.startsWith(notePath)) {
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

    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  });

  // Create the window
  const title = config.title || 'Exported Note';
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Inject note-viewer.css and theme on every navigation (mirrors main app behaviour)
  mainWindow.webContents.on('dom-ready', () => {
    if (NOTE_CSS) mainWindow.webContents.insertCSS(NOTE_CSS);
  });

  // Load the note's index.html via the note:// protocol
  mainWindow.loadURL('note://notes/note/index.html');
});

app.on('window-all-closed', () => {
  if (sqliteDb) try { sqliteDb.close(); } catch {}
  if (sqliteDbReadonly) try { sqliteDbReadonly.close(); } catch {}
  app.quit();
});

// ─── noteDB IPC ───────────────────────────────────────────────────────────────

ipcMain.handle('note-db:get', (_e, _noteId, key) => {
  if (typeof key !== 'string' || !key) return null;
  const data = noteDb.noteDbLoad(notePath, noteId);
  const val = data[key];
  return (val !== undefined) ? val : null;
});

ipcMain.handle('note-db:set', (_e, _noteId, key, value) => {
  if (typeof key !== 'string' || !key) throw new Error('key must be a non-empty string');
  if (value === undefined) throw new Error('value is required');
  const data = noteDb.noteDbLoad(notePath, noteId);
  data[key] = value;
  noteDb.noteDbFlush(notePath, noteId, data);
});

ipcMain.handle('note-db:delete', (_e, _noteId, key) => {
  if (typeof key !== 'string' || !key) throw new Error('key must be a non-empty string');
  const data = noteDb.noteDbLoad(notePath, noteId);
  if (Object.prototype.hasOwnProperty.call(data, key)) {
    delete data[key];
    noteDb.noteDbFlush(notePath, noteId, data);
  }
});

ipcMain.handle('note-db:list', (_e, _noteId) => {
  const data = noteDb.noteDbLoad(notePath, noteId);
  return Object.keys(data);
});

// ─── noteFiles IPC ────────────────────────────────────────────────────────────

ipcMain.handle('note-files:save', (_e, _noteId, name, data) => {
  if (!isValidNoteFileName(name)) throw new Error('Invalid file name');
  const dir = noteFilesDir();
  const filePath = path.resolve(path.join(dir, name));
  if (!filePath.startsWith(dir + path.sep)) throw new Error('Invalid file name (path traversal detected)');
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + '.tmp';
  let buf;
  if (typeof data === 'string') {
    buf = Buffer.from(data, 'utf8');
  } else {
    buf = Buffer.from(data);
  }
  try {
    fs.writeFileSync(tmpPath, buf);
    fs.renameSync(tmpPath, filePath);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

ipcMain.handle('note-files:load', (_e, _noteId, name) => {
  if (!isValidNoteFileName(name)) return null;
  const dir = noteFilesDir();
  const filePath = path.join(dir, name);
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

ipcMain.handle('note-files:delete', (_e, _noteId, name) => {
  if (!isValidNoteFileName(name)) throw new Error('Invalid file name');
  const dir = noteFilesDir();
  const filePath = path.join(dir, name);
  try { fs.unlinkSync(filePath); } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
});

ipcMain.handle('note-files:list', (_e, _noteId) => {
  const dir = noteFilesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
});

ipcMain.handle('note-files:import', async (_e, _noteId, options) => {
  const dir = noteFilesDir();
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
  return basename;
});

// ─── noteSQL IPC ──────────────────────────────────────────────────────────────

ipcMain.handle('note-sql:exec', (_e, _noteId, sql, params) => {
  if (typeof sql !== 'string' || !sql) throw new Error('sql must be a non-empty string');
  if (params !== undefined && !Array.isArray(params)) throw new Error('params must be an array');
  const db = noteSqlOpen();
  const stmt = db.prepare(sql);
  const result = stmt.run(...(params || []));
  return { changes: result.changes };
});

ipcMain.handle('note-sql:query', (_e, _noteId, sql, params) => {
  if (typeof sql !== 'string' || !sql) throw new Error('sql must be a non-empty string');
  if (params !== undefined && !Array.isArray(params)) throw new Error('params must be an array');
  const db = noteSqlOpen();
  const stmt = db.prepare(sql);
  return stmt.all(...(params || []));
});

ipcMain.handle('note-sql:tables', (_e, _noteId) => {
  const db = noteSqlOpenReadonly();
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

ipcMain.handle('note-sql:query-readonly', (_e, _noteId, sql, params) => {
  if (typeof sql !== 'string' || !sql) throw new Error('sql must be a non-empty string');
  if (params !== undefined && !Array.isArray(params)) throw new Error('params must be an array');
  const db = noteSqlOpenReadonly();
  if (!db) throw new Error('No database exists');
  const stmt = db.prepare(sql);
  return stmt.all(...(params || []));
});

// ─── noteScripts IPC ──────────────────────────────────────────────────────────

ipcMain.handle('note-scripts:list', (_e, _noteId) => {
  const dir = noteScriptsDir();
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir);
  const results = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    try {
      const stat = fs.statSync(path.join(dir, name));
      if (!stat.isFile()) continue;
      // All scripts are auto-approved in exported apps
      results.push({ name, size: stat.size, modified: stat.mtime.toISOString(), approved: true });
    } catch {}
  }
  return results;
});

ipcMain.handle('note-scripts:approve', () => true);
ipcMain.handle('note-scripts:revoke', () => true);

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

ipcMain.handle('note-scripts:stop-by-name', (_e, _noteId, scriptName) => {
  let killed = 0;
  for (const [, entry] of _runningScripts) {
    if (entry.scriptName === scriptName) {
      try { entry.process.kill(); killed++; } catch {}
    }
  }
  return killed;
});

ipcMain.handle('note-scripts:run', (_e, _noteId, scriptName, args) => {
  if (!isValidNoteFileName(scriptName)) return { stdout: '', stderr: 'Invalid script name', exitCode: -1, error: 'invalid_name' };
  if (args !== undefined && args !== null) {
    if (!Array.isArray(args)) return { stdout: '', stderr: 'args must be an array', exitCode: -1, error: 'invalid_args' };
    if (args.length > 50) return { stdout: '', stderr: 'Too many arguments', exitCode: -1, error: 'invalid_args' };
    for (const a of args) {
      if (typeof a !== 'string') return { stdout: '', stderr: 'All args must be strings', exitCode: -1, error: 'invalid_args' };
    }
  }
  const dir = noteScriptsDir();
  const scriptPath = path.resolve(path.join(dir, scriptName));
  if (!scriptPath.startsWith(dir + path.sep) && scriptPath !== dir) {
    return { stdout: '', stderr: 'Path traversal detected', exitCode: -1, error: 'path_traversal' };
  }
  if (!fs.existsSync(scriptPath)) return { stdout: '', stderr: 'Script not found', exitCode: -1, error: 'not_found' };

  const envConfig = _loadScriptEnv();
  const cmdArgs = resolveInterpreter(scriptPath, envConfig);
  const bin = cmdArgs.shift();
  const finalArgs = [...cmdArgs, ...(args || [])];
  const runId = _nextRunId++;

  return new Promise((resolve) => {
    const child = spawn(bin, finalArgs, {
      cwd: dir,
      env: _buildScriptEnv(envConfig),
    });

    const entry = { noteId, scriptName, startedAt: Date.now(), process: child, stdout: '', stderr: '' };
    _runningScripts.set(runId, entry);
    _notifyScriptsRunChanged();

    child.stdout.on('data', (chunk) => { entry.stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { entry.stderr += chunk.toString(); });

    child.on('close', (code) => {
      _runningScripts.delete(runId);
      _notifyScriptsRunChanged();
      // Auto-log script output
      const logsDir = noteScriptsLogsDir();
      try {
        fs.mkdirSync(logsDir, { recursive: true });
        const logFile = path.join(logsDir, scriptName + '.log');
        const header = `\n--- ${new Date().toISOString()} (exit ${code ?? -1}) ---\n`;
        const content = entry.stdout + (entry.stderr ? '\n[stderr]\n' + entry.stderr : '');
        fs.appendFileSync(logFile, header + content + '\n');
        _rotateLogFile(logFile, 500 * 1024);
      } catch {}
      const result = { stdout: entry.stdout, stderr: entry.stderr, exitCode: code ?? -1 };
      if (code !== 0 && entry.stderr) {
        const hint = _detectMissingModule(entry.stderr);
        if (hint) result.missingModule = hint;
      }
      resolve(result);
    });

    child.on('error', (err) => {
      _runningScripts.delete(runId);
      _notifyScriptsRunChanged();
      const result = { stdout: entry.stdout, stderr: err.message, exitCode: -1, error: 'exec_error' };
      const hint = _detectMissingModule(err.message);
      if (hint) result.missingModule = hint;
      resolve(result);
    });
  });
});

// ─── noteLog IPC ──────────────────────────────────────────────────────────────

ipcMain.handle('note-log:write', (_e, _noteId, msg) => {
  if (typeof msg !== 'string') return;
  const logsDir = noteScriptsLogsDir();
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const logFile = path.join(logsDir, 'frontend.log');
    const line = `[${new Date().toISOString()}] ${msg.slice(0, 10000)}\n`;
    fs.appendFileSync(logFile, line);
    _rotateLogFile(logFile, 500 * 1024);
  } catch {}
});

ipcMain.handle('note-logs:list', (_e, _noteId) => {
  const logsDir = noteScriptsLogsDir();
  if (!fs.existsSync(logsDir)) return [];
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

ipcMain.handle('note-logs:read', (_e, _noteId, logName) => {
  if (typeof logName !== 'string' || !logName.endsWith('.log')) return '';
  if (!isValidNoteFileName(logName)) return '';
  const logsDir = noteScriptsLogsDir();
  const logPath = path.resolve(path.join(logsDir, logName));
  if (!logPath.startsWith(logsDir + path.sep) && logPath !== path.join(logsDir, logName)) return '';
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    return content.length > 100000 ? content.slice(-100000) : content;
  } catch { return ''; }
});

ipcMain.handle('note-logs:clear', (_e, _noteId, logName) => {
  if (typeof logName !== 'string' || !logName.endsWith('.log')) return false;
  if (!isValidNoteFileName(logName)) return false;
  const logsDir = noteScriptsLogsDir();
  const logPath = path.resolve(path.join(logsDir, logName));
  if (!logPath.startsWith(logsDir + path.sep) && logPath !== path.join(logsDir, logName)) return false;
  try { fs.writeFileSync(logPath, ''); return true; } catch { return false; }
});

ipcMain.handle('note-logging:get', () => true);
ipcMain.handle('note-logging:set', () => true);
