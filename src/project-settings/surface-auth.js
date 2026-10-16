// Authorization policy kept independent of Electron so all denial paths are testable.
function documentURL(value) { try { const url = new URL(value); url.hash = ''; return url.href; } catch { return null; } }
function sameDocument(first, second) { const a = documentURL(first); return a !== null && a === documentURL(second); }
function deny() { const error = new Error('This settings surface is not authorized'); error.code = 'UNAUTHORIZED'; throw error; }
function requireHost(event, host) {
  if (!host || event.sender !== host || event.senderFrame !== host.mainFrame) deny();
}
function requireGuest(event, mounts, workspace) {
  const mounted = mounts.get(event.sender.id);
  if (!mounted || mounted.workspace !== workspace || event.senderFrame !== event.sender.mainFrame || !sameDocument(event.sender.getURL(), mounted.url)) deny();
  return mounted;
}
function requireMount(contents, host, surface, trustedGuests) {
  if (!contents || contents.getType() !== 'webview' || contents.hostWebContents !== host || !trustedGuests.has(contents) || !sameDocument(contents.getURL(), surface.url)) deny();
}
function attestGuest(event, token, pending, workspace) {
  const mount = typeof token === 'string' ? pending.get(token) : null;
  if (!mount || mount.workspace !== workspace || event.sender.getType() !== 'webview' || event.sender.hostWebContents !== mount.host || event.senderFrame !== event.sender.mainFrame) deny();
  pending.delete(token);
  return true;
}
function admittedSurface(surface, attachment, workspace, snapshots) {
  const hash = attachment?.url?.match(/^note:\/\/settings\/default\/([a-f0-9]{64})\/index\.html(?:#.*)?$/)?.[1];
  if (surface.kind === 'default' && attachment?.kind === 'default' && attachment.workspace === workspace && hash && snapshots.has(hash)) return { ...surface, url: attachment.url };
  return surface;
}
function configureGuest(preferences, params, expectedURL, preload) {
  if (String(params.src || '').startsWith('note://settings/')) {
    if (!expectedURL || !sameDocument(params.src, expectedURL)) return false;
    Object.assign(preferences, { preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true });
  } else if (String(preferences.preload || '').includes('settings-preload.js')) return false;
  return true;
}
module.exports = { requireHost, requireGuest, requireMount, configureGuest, sameDocument, attestGuest, admittedSurface };
