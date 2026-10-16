const { contextBridge, ipcRenderer } = require('electron');
// A one-use capability proves this preload was assigned by the settings host.
const mountArgument = process.argv.find(value => value.startsWith('--nextprob-settings-mount='));
if (mountArgument) ipcRenderer.sendSync('settings-surface:identify', mountArgument.slice('--nextprob-settings-mount='.length));
// This preload deliberately omits noteDB and the ordinary note/host bridges.
let readiness, mounted = false, finishMount;
// Listen before the document can request settings: registration may complete
// either before or after the one initial authorization probe.
const mountedListener = (_event, context) => {
  if (context?.apiVersion !== 1) return;
  mounted = true;
  finishMount?.();
};
ipcRenderer.on('settings-surface:mounted', mountedListener);
function ready() {
  if (!readiness) readiness = new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      ipcRenderer.removeListener('settings-surface:mounted', mountedListener);
      finishMount = null;
      if (error) reject(error); else resolve();
    };
    const deadline = setTimeout(() => {
      const error = new Error('This settings surface was not mounted by the application');
      error.code = 'UNAUTHORIZED';
      finish(error);
    }, 5000);
    finishMount = () => finish();
    ipcRenderer.invoke('settings-surface:ready').then(result => {
      if (!result.error) finish();
      else if (result.error.code !== 'UNAUTHORIZED') {
        const error = new Error(result.error.message); error.code = result.error.code; finish(error);
      }
      // An early unauthorized probe waits for the explicit host mount event.
    }, finish);
    if (mounted) finish();
  });
  return readiness;
}
// Electron clones Error instances across contextBridge without custom fields.
// Keep IPC envelopes in the isolated world; construct public errors in the note's
// own world so callers can reliably inspect both Error and Error.code.
const methods = new Set(['context', 'theme', 'list', 'browse', 'read', 'save', 'updateDraft', 'getDraft', 'discardDraft']);
contextBridge.exposeInMainWorld('__nextprobSettingsTransport', {
  async request(method, args) {
    if (!methods.has(method) || !Array.isArray(args)) return { error: { code: 'INVALID_METHOD', message: 'Unsupported settings operation' } };
    try {
      await ready();
      return await ipcRenderer.invoke(`settings-surface:${method}`, ...args);
    } catch (error) { return { error: { code: error.code || 'SETTINGS_ERROR', message: error.message || String(error) } }; }
  },
  onThemeChanged: cb => { const listener = (_event, theme) => cb(theme); ipcRenderer.on('settings-surface:theme-changed', listener); return () => ipcRenderer.removeListener('settings-surface:theme-changed', listener); },
  onChanged: cb => { const listener = (_event, change) => cb(change); ipcRenderer.on('settings-surface:changed', listener); return () => ipcRenderer.removeListener('settings-surface:changed', listener); },
});
contextBridge.executeInMainWorld({ func: () => {
  const transport = window.__nextprobSettingsTransport;
  async function invoke(method, ...args) {
    const result = await transport.request(method, args);
    if (result.error) {
      const error = new Error(result.error.message);
      error.code = result.error.code;
      throw error;
    }
    return result.value;
  }
  Object.defineProperty(window, 'settings', { configurable: false, writable: false, value: Object.freeze({
    apiVersion: 1,
    getContext: () => invoke('context'),
    getTheme: () => invoke('theme'),
    onThemeChanged: cb => transport.onThemeChanged(cb),
    list: () => invoke('list'),
    browse: (workspaceId, relative) => invoke('browse', workspaceId, relative),
    read: (workspaceId, relative) => invoke('read', workspaceId, relative),
    save: (workspaceId, relative, text, revision) => invoke('save', workspaceId, relative, text, revision),
    updateDraft: (workspaceId, relative, text, revision) => invoke('updateDraft', workspaceId, relative, text, revision),
    getDraft: (workspaceId, relative) => invoke('getDraft', workspaceId, relative),
    discardDraft: (workspaceId, relative) => invoke('discardDraft', workspaceId, relative),
    onChanged: cb => transport.onChanged(cb),
  }) });
} });
