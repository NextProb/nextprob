const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

let terminalWindow = null;
let mainWindowRef = null;
let currentCwd = null;
let terminalWidth = 600;
let terminalHeight = 300;

// Layout offsets from renderer: { sidebarLeft, titleBarHeight, rightBarWidth }
let panelOffsets = null;

// Window state: 'normal' | 'minimized' | 'maximized'
let terminalState = 'normal';
let savedBounds = null;
let resizingProgrammatically = false;
const TAB_BAR_HEIGHT = 42; // drag-bar (6px) + tab-bar (30px) + border (1px) + padding

// Track IPC handlers so we can remove them on cleanup
let ipcHandlersRegistered = false;

// Multi-tab state
let nextTabId = 1;
const tabs = new Map(); // tabId -> { pty, buffer }
let activeTabId = null;

// Max buffer size for inactive tabs (100KB)
const MAX_INACTIVE_BUFFER = 100 * 1024;

// --- Claude Code activity detection ---

// Matches CSI sequences, OSC sequences, charset switches, and other common escapes
const ANSI_STRIP_RE = /\x1b(?:\[[\x20-\x3f]*[\x40-\x7e]|\][^\x07\x1b]*(?:\x07|\x1b\\)|\([A-B0-2]|[78DEHM=>NOcl]|\x20[A-Z])/g;
const DETECT_RING_SIZE = 2048;

function stripAnsi(str) {
  return str.replace(ANSI_STRIP_RE, '');
}

function initClaudeDetection(tab) {
  tab.claudeActive = false;
  tab.claudeState = 'idle';
  tab.inputLine = '';
  tab.detectRing = '';
  tab.inAltScreen = false;
  tab.doneTimer = null;
}

function emitTabIndicator(tabId, state) {
  if (terminalWindow && !terminalWindow.isDestroyed() && !terminalWindow.webContents.isDestroyed()) {
    terminalWindow.webContents.send('terminal:tabIndicator', tabId, state);
  }
}

function setClaudeState(tab, tabId, newState) {
  if (tab.claudeState === newState) return;
  if (tab.doneTimer) { clearTimeout(tab.doneTimer); tab.doneTimer = null; }
  tab.claudeState = newState;
  emitTabIndicator(tabId, newState);

  if (newState === 'done') {
    tab.doneTimer = setTimeout(() => {
      if (tab.claudeState === 'done') {
        tab.claudeState = 'idle';
        emitTabIndicator(tabId, 'idle');
      }
      tab.doneTimer = null;
    }, 5000);
  }
}

function trackTerminalInput(tab, tabId, data) {
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    const code = ch.charCodeAt(0);

    if (ch === '\r' || ch === '\n') {
      if (!tab.claudeActive && /\bclaude\b/i.test(tab.inputLine)) {
        tab.claudeActive = true;
        tab.detectRing = '';
        tab.inAltScreen = false;
        setClaudeState(tab, tabId, 'running');
      } else if (tab.claudeActive && (tab.claudeState === 'permission' || tab.claudeState === 'input' || tab.claudeState === 'waiting')) {
        tab.detectRing = '';  // Clear so old text doesn't re-trigger
        setClaudeState(tab, tabId, 'running');
      }
      tab.inputLine = '';
    } else if (ch === '\x1b' && i + 1 >= data.length) {
      // Bare Escape (not part of a sequence) — "Esc to cancel" in permission UI
      if (tab.claudeActive && (tab.claudeState === 'permission' || tab.claudeState === 'input')) {
        tab.detectRing = '';
        setClaudeState(tab, tabId, 'running');
      }
      tab.inputLine = '';
    } else if (ch === '\x03') {
      tab.inputLine = '';
    } else if (ch === '\x7f' || ch === '\x08') {
      tab.inputLine = tab.inputLine.slice(0, -1);
    } else if (code >= 32 && code < 127) {
      tab.inputLine += ch;
      // Single-key permission response (y/n, number selection)
      if (tab.claudeActive && tab.claudeState === 'permission' && /^[ynYN1-9]$/.test(ch)) {
        tab.detectRing = '';
        setClaudeState(tab, tabId, 'running');
      }
    }
  }
}

function detectClaudeOutput(tab, tabId, data) {
  // Track alt screen transitions while Claude is active
  if (tab.claudeActive) {
    if (data.includes('\x1b[?1049h') || data.includes('\x1b[?47h')) {
      tab.inAltScreen = true;
    }
    if (data.includes('\x1b[?1049l') || data.includes('\x1b[?47l')) {
      if (tab.inAltScreen) {
        tab.inAltScreen = false;
        tab.claudeActive = false;
        tab.detectRing = '';
        setClaudeState(tab, tabId, 'done');
        return;
      }
    }
  }

  if (!tab.claudeActive) return;

  const stripped = stripAnsi(data);
  if (stripped.length === 0) return;

  tab.detectRing += stripped;
  if (tab.detectRing.length > DETECT_RING_SIZE) {
    tab.detectRing = tab.detectRing.slice(-DETECT_RING_SIZE);
  }

  const tail = tab.detectRing.slice(-500);

  // Permission/approval prompts
  // Claude Code TUI strips spaces when we remove ANSI cursor-positioning codes,
  // so match spaceless variants: "Doyouwanttoproceed?", "Esctocancel", etc.
  if (/Do\s*you\s*want\s*to\s*proceed\s*\?/i.test(tail) ||
      /Esc\s*to\s*cancel/i.test(tail) ||
      /Yes,?\s*and\s*always\s*allow/i.test(tail) ||
      /Do\s*you\s*want\s*to\s*allow/i.test(tail) ||
      (/\bAllow\b/.test(tail) && /\?/.test(tail)) ||
      /\(Y\)es/.test(tail)) {
    setClaudeState(tab, tabId, 'permission');
    return;
  }

  // Claude Code waiting for user input — status bar shows "? for shortcuts"
  if (/\?\s*for\s*shortcuts/i.test(tail)) {
    setClaudeState(tab, tabId, 'waiting');
    return;
  }

  // Input/form request patterns
  if (/press\s*Enter\s*to\s*continue/i.test(tail) ||
      /type\s*.+\s*to\s*continue/i.test(tail)) {
    setClaudeState(tab, tabId, 'input');
    return;
  }

  // Claude Code actively processing — status bar shows "esc to interrupt"
  if (/esc\s*to\s*interrupt/i.test(tail)) {
    if (tab.claudeState !== 'running') {
      setClaudeState(tab, tabId, 'running');
    }
    return;
  }

  // Non-TUI mode: detect shell prompt for completion
  if (!tab.inAltScreen && tab.detectRing.length > 100) {
    const lastLine = tab.detectRing.split('\n').pop().trim();
    if (/^[\w@.:~/()\-]*[$%#]\s*$/.test(lastLine)) {
      tab.claudeActive = false;
      tab.detectRing = '';
      setClaudeState(tab, tabId, 'done');
      return;
    }
  }

  // Default: set to running only from idle/done
  if (tab.claudeState === 'idle' || tab.claudeState === 'done') {
    setClaudeState(tab, tabId, 'running');
  }
}

function cleanupClaudeDetection(tab) {
  if (tab.doneTimer) { clearTimeout(tab.doneTimer); tab.doneTimer = null; }
}

function getShell() {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || '/bin/zsh';
}

function spawnPtyForTab(tabId, cols, rows) {
  const shell = getShell();
  const p = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: currentCwd || os.homedir(),
    env: process.env,
  });

  const tab = { pty: p, buffer: '' };
  initClaudeDetection(tab);
  tabs.set(tabId, tab);

  p.onData((data) => {
    if (!terminalWindow || terminalWindow.isDestroyed() || terminalWindow.webContents.isDestroyed()) return;

    detectClaudeOutput(tab, tabId, data);

    if (tabId === activeTabId) {
      terminalWindow.webContents.send('terminal:data', tabId, data);
    } else {
      // Buffer output for inactive tabs (cap size)
      tab.buffer += data;
      if (tab.buffer.length > MAX_INACTIVE_BUFFER) {
        tab.buffer = tab.buffer.slice(-MAX_INACTIVE_BUFFER);
      }
    }
  });

  p.onExit(() => {
    if (!terminalWindow || terminalWindow.isDestroyed() || terminalWindow.webContents.isDestroyed()) return;
    if (tabs.has(tabId)) {
      cleanupClaudeDetection(tab);
      tabs.delete(tabId);
      terminalWindow.webContents.send('terminal:tabClosed', tabId);
      // If this was the active tab, activate another
      if (activeTabId === tabId) {
        const remaining = Array.from(tabs.keys());
        if (remaining.length > 0) {
          activeTabId = remaining[remaining.length - 1];
          terminalWindow.webContents.send('terminal:tabActivated', activeTabId);
        } else {
          // No tabs left — create a new one
          createTab();
        }
      }
    }
  });

  return tabId;
}

function createTab(cols, rows) {
  const tabId = nextTabId++;
  spawnPtyForTab(tabId, cols, rows);
  activeTabId = tabId;
  if (terminalWindow && !terminalWindow.isDestroyed() && !terminalWindow.webContents.isDestroyed()) {
    terminalWindow.webContents.send('terminal:tabCreated', tabId);
  }
  return tabId;
}

function closeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  tab.pty.kill();
  // onExit handler will clean up the map and notify renderer
}

function switchTab(tabId) {
  if (!tabs.has(tabId)) return;
  activeTabId = tabId;
  // Flush buffered output
  const tab = tabs.get(tabId);
  if (tab.buffer && terminalWindow && !terminalWindow.isDestroyed() && !terminalWindow.webContents.isDestroyed()) {
    terminalWindow.webContents.send('terminal:data', tabId, tab.buffer);
    tab.buffer = '';
  }
}

function killAllTabs() {
  for (const [, tab] of tabs) {
    try { tab.pty.kill(); } catch {}
  }
  tabs.clear();
  activeTabId = null;
}

// Panel offsets listener — registered early so it captures offsets before terminal opens
ipcMain.on('terminal:panelBounds', (_e, offsets) => {
  panelOffsets = offsets;
});

function registerIpcHandlers() {
  if (ipcHandlersRegistered) return;

  ipcMain.on('terminal:input', (_e, data) => {
    if (activeTabId !== null) {
      const tab = tabs.get(activeTabId);
      if (tab) {
        trackTerminalInput(tab, activeTabId, data);
        tab.pty.write(data);
      }
    }
  });

  ipcMain.on('terminal:resize', (_e, cols, rows) => {
    if (activeTabId !== null) {
      const tab = tabs.get(activeTabId);
      if (tab) {
        try { tab.pty.resize(cols, rows); } catch {}
      }
    }
  });

  ipcMain.on('terminal:minimize', () => {
    if (!terminalWindow || terminalWindow.isDestroyed()) return;
    if (terminalState === 'minimized') {
      // Restore from minimized
      terminalWindow.setResizable(true);
      terminalWindow.setMinimumSize(300, 120);
      if (savedBounds) {
        resizingProgrammatically = true;
        terminalWindow.setBounds(clampToDisplay(savedBounds));
        resizingProgrammatically = false;
        savedBounds = null;
      }
      terminalState = 'normal';
    } else {
      // Minimize: collapse to tab-bar height
      // If currently maximized, keep original savedBounds (pre-maximize)
      if (terminalState !== 'maximized') {
        savedBounds = terminalWindow.getBounds();
      }
      const b = terminalWindow.getBounds();
      const panel = mainWindowRef ? getNotePanelScreenBounds(mainWindowRef) : null;
      const bottomY = panel ? (panel.y + panel.height - TAB_BAR_HEIGHT) : b.y;
      terminalWindow.setMinimumSize(300, TAB_BAR_HEIGHT);
      resizingProgrammatically = true;
      terminalWindow.setBounds(clampToDisplay({ x: b.x, y: bottomY, width: b.width, height: TAB_BAR_HEIGHT }));
      resizingProgrammatically = false;
      terminalWindow.setResizable(false);
      terminalState = 'minimized';
    }
    notifyTerminalState();
  });

  ipcMain.on('terminal:maximize', () => {
    if (!terminalWindow || terminalWindow.isDestroyed() || !mainWindowRef) return;
    if (terminalState === 'maximized') {
      // Restore from maximized
      if (savedBounds) {
        resizingProgrammatically = true;
        terminalWindow.setBounds(clampToDisplay(savedBounds));
        resizingProgrammatically = false;
        savedBounds = null;
      }
      terminalState = 'normal';
    } else {
      // If currently minimized, restore resizable first and keep original savedBounds
      if (terminalState === 'minimized') {
        terminalWindow.setResizable(true);
        terminalWindow.setMinimumSize(300, 120);
        // savedBounds already holds the pre-minimize bounds — keep it
      } else {
        savedBounds = terminalWindow.getBounds();
      }
      // Maximize: fill the note panel area
      const panel = getNotePanelScreenBounds(mainWindowRef);
      resizingProgrammatically = true;
      terminalWindow.setBounds(clampToDisplay({ x: panel.x, y: panel.y, width: panel.width, height: panel.height }));
      resizingProgrammatically = false;
      terminalState = 'maximized';
    }
    notifyTerminalState();
  });

  ipcMain.handle('terminal:createTab', () => {
    return createTab();
  });

  ipcMain.handle('terminal:closeTab', (_e, tabId) => {
    closeTab(tabId);
  });

  ipcMain.on('terminal:switchTab', (_e, tabId) => {
    switchTab(tabId);
  });

  // Renderer signals its listeners are ready — create the first tab now.
  // Uses `on` (not `once`) so it fires each time the terminal is reopened.
  ipcMain.on('terminal:ready', () => {
    if (tabs.size === 0) {
      createTab();
    }
  });

  ipcHandlersRegistered = true;
}

// Compute the note panel area in screen coordinates from the main window bounds
// and the layout offsets sent by the renderer.
function getNotePanelScreenBounds(mainWindow) {
  const wb = mainWindow.getBounds();
  const cb = mainWindow.getContentBounds();

  if (panelOffsets) {
    const left = cb.x + panelOffsets.sidebarLeft;
    const top = cb.y + panelOffsets.titleBarHeight;
    const width = cb.width - panelOffsets.sidebarLeft - panelOffsets.rightBarWidth;
    const height = cb.height - panelOffsets.titleBarHeight - (panelOffsets.bottomBarHeight || 0);
    return { x: left, y: top, width, height };
  }

  // Fallback: use full content bounds
  return cb;
}

// Clamp bounds so the window stays fully within the work area of the
// display nearest to the given coordinates.  This prevents the terminal
// from ending up off-screen on multi-monitor setups (e.g. when the main
// window sits at the bottom edge of an upper screen).
function clampToDisplay(bounds) {
  const { workArea } = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  let { x, y, width, height } = bounds;

  // Shrink if larger than work area (respect minimums)
  if (width > workArea.width) width = Math.max(300, workArea.width);
  if (height > workArea.height) height = Math.max(120, workArea.height);

  // Push back into work area
  if (x < workArea.x) x = workArea.x;
  if (y < workArea.y) y = workArea.y;
  if (x + width > workArea.x + workArea.width) x = workArea.x + workArea.width - width;
  if (y + height > workArea.y + workArea.height) y = workArea.y + workArea.height - height;

  return { x, y, width, height };
}

function getInitialBounds(mainWindow) {
  const panel = getNotePanelScreenBounds(mainWindow);
  const w = Math.min(terminalWidth, panel.width - 20);
  const h = Math.min(terminalHeight, panel.height - 20);
  return clampToDisplay({
    x: panel.x + Math.round((panel.width - w) / 2),
    y: panel.y + panel.height - h - 10,
    width: Math.max(300, w),
    height: Math.max(120, h),
  });
}

function createTerminalWindow(mainWindow, workspacePath) {
  if (terminalWindow && !terminalWindow.isDestroyed()) {
    terminalWindow.focus();
    return;
  }

  mainWindowRef = mainWindow;
  currentCwd = workspacePath || currentCwd || os.homedir();
  terminalState = 'normal';
  savedBounds = null;

  const bounds = getInitialBounds(mainWindow);

  terminalWindow = new BrowserWindow({
    parent: mainWindow,
    frame: false,
    transparent: false,
    show: false,
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 300,
    minHeight: 120,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'terminal-preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      partition: 'persist:terminal',
    },
  });

  terminalWindow.loadFile('terminal/terminal.html');

  terminalWindow.once('ready-to-show', () => {
    terminalWindow.show();
    notifyMainVisibility(true);
  });

  terminalWindow.on('closed', () => {
    terminalWindow = null;
    killAllTabs();
    notifyMainVisibility(false);
  });

  // Track size changes so we remember them, and reset state on user drag
  function onUserResizeOrMove(isResize) {
    if (resizingProgrammatically) return;
    // When minimized: window is not resizable so only move events fire — don't reset on move
    if (terminalState === 'minimized') return;
    if (terminalState === 'maximized') {
      terminalState = 'normal';
      savedBounds = null;
      notifyTerminalState();
    }
  }

  terminalWindow.on('resize', () => {
    if (terminalWindow && !terminalWindow.isDestroyed()) {
      const b = terminalWindow.getBounds();
      terminalWidth = b.width;
      terminalHeight = b.height;
      onUserResizeOrMove(true);
    }
  });

  terminalWindow.on('move', () => {
    onUserResizeOrMove(false);
  });

  // Hide/show with parent
  mainWindow.on('minimize', () => {
    if (terminalWindow && !terminalWindow.isDestroyed()) terminalWindow.hide();
  });
  mainWindow.on('restore', () => {
    if (terminalWindow && !terminalWindow.isDestroyed()) {
      terminalWindow.show();
    }
  });

  registerIpcHandlers();
  // Tab creation is deferred until the renderer signals it's ready
  // (see terminal:ready IPC) to avoid a race where the tabCreated
  // message is sent before the renderer has registered its listeners.
}

function destroyTerminalWindow() {
  killAllTabs();
  if (terminalWindow && !terminalWindow.isDestroyed()) {
    terminalWindow.close();
  }
  terminalWindow = null;
  notifyMainVisibility(false);
}

function toggleTerminalWindow(mainWindow, workspacePath) {
  if (terminalWindow && !terminalWindow.isDestroyed()) {
    destroyTerminalWindow();
    return false;
  } else {
    createTerminalWindow(mainWindow, workspacePath);
    return true;
  }
}

function isTerminalVisible() {
  return !!(terminalWindow && !terminalWindow.isDestroyed());
}

function setWorkspacePath(wsPath) {
  currentCwd = wsPath;
}

function notifyTerminalState() {
  if (terminalWindow && !terminalWindow.isDestroyed() && !terminalWindow.webContents.isDestroyed()) {
    terminalWindow.webContents.send('terminal:stateChanged', terminalState);
  }
}

function notifyMainVisibility(visible) {
  if (mainWindowRef && !mainWindowRef.isDestroyed() && !mainWindowRef.webContents.isDestroyed()) {
    mainWindowRef.webContents.send('terminal:visibilityChanged', visible, visible ? terminalHeight : 0);
  }
}

function notifyThemeChanged(theme) {
  if (terminalWindow && !terminalWindow.isDestroyed() && !terminalWindow.webContents.isDestroyed()) {
    terminalWindow.webContents.send('terminal:themeChanged', theme);
  }
}

function cleanup() {
  destroyTerminalWindow();
}

function getTerminalHeight() {
  return terminalHeight;
}

module.exports = {
  createTerminalWindow,
  destroyTerminalWindow,
  toggleTerminalWindow,
  isTerminalVisible,
  setWorkspacePath,
  notifyThemeChanged,
  cleanup,
  getTerminalHeight,
};
