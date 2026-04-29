const { contextBridge, ipcRenderer } = require('electron');

// Apply theme before first paint (same pattern as main preload.js)
const _theme = ipcRenderer.sendSync('theme:get');
if (_theme === 'light') {
  if (document.documentElement) {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.setAttribute('data-theme', 'light');
    }, { once: true });
  }
}

contextBridge.exposeInMainWorld('terminalApi', {
  // PTY data flow (tagged with tabId)
  onData: (cb) => ipcRenderer.on('terminal:data', (_e, tabId, data) => cb(tabId, data)),
  sendData: (data) => ipcRenderer.send('terminal:input', data),
  resize: (cols, rows) => ipcRenderer.send('terminal:resize', cols, rows),

  // Tab management
  createTab: () => ipcRenderer.invoke('terminal:createTab'),
  closeTab: (tabId) => ipcRenderer.invoke('terminal:closeTab', tabId),
  switchTab: (tabId) => ipcRenderer.send('terminal:switchTab', tabId),
  onTabCreated: (cb) => ipcRenderer.on('terminal:tabCreated', (_e, tabId) => cb(tabId)),
  onTabClosed: (cb) => ipcRenderer.on('terminal:tabClosed', (_e, tabId) => cb(tabId)),
  onTabActivated: (cb) => ipcRenderer.on('terminal:tabActivated', (_e, tabId) => cb(tabId)),
  onTabIndicator: (cb) => ipcRenderer.on('terminal:tabIndicator', (_e, tabId, state) => cb(tabId, state)),

  // Theme sync
  getTheme: () => ipcRenderer.sendSync('theme:get'),
  onThemeChanged: (cb) => ipcRenderer.on('terminal:themeChanged', (_e, theme) => cb(theme)),

  // Close terminal
  closeTerminal: () => ipcRenderer.invoke('terminal:toggle'),

  // Minimize / maximize
  minimize: () => ipcRenderer.send('terminal:minimize'),
  maximize: () => ipcRenderer.send('terminal:maximize'),
  onStateChanged: (cb) => ipcRenderer.on('terminal:stateChanged', (_e, state) => cb(state)),

  // Signal that the renderer's listeners are registered
  ready: () => ipcRenderer.send('terminal:ready'),
});
