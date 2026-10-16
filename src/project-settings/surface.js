// App-owned selection and safe routing for the replaceable settings document.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DEFAULT_URL = 'note://settings/default/index.html';
function inside(root, candidate) { return candidate === root || candidate.startsWith(root + path.sep); }
function resolveInside(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative) || relative.split('/').some(p => p === '..' || p === '.')) throw new Error('Unsafe settings path');
  const base = fs.realpathSync(root);
  const resolved = fs.realpathSync(path.join(base, relative));
  if (!inside(base, resolved)) throw new Error('Settings files must remain inside their project');
  return resolved;
}
function createSettingsSurfaceStore(userData) {
  const file = path.join(userData, 'settings-surfaces.json');
  const key = root => crypto.createHash('sha256').update(fs.realpathSync(root)).digest('hex');
  function load() { try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return data.version === 1 && data.projects && typeof data.projects === 'object' ? data.projects : {}; } catch { return {}; } }
  function set(root, relative) {
    if (relative !== null) { const target = resolveInside(root, relative); if (!/\.html?$/i.test(target) || !fs.statSync(target).isFile()) throw new Error('Choose an HTML note'); }
    const projects = load();
    if (relative === null) delete projects[key(root)]; else projects[key(root)] = relative;
    fs.mkdirSync(userData, { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, projects }, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  function get(root) {
    const relative = load()[key(root)];
    if (!relative) return { apiVersion: 1, kind: 'default', url: DEFAULT_URL };
    try { const target = resolveInside(root, relative); if (!fs.statSync(target).isFile() || !/\.html?$/i.test(target)) throw new Error('Selected settings note is unavailable'); return { apiVersion: 1, kind: 'custom', path: relative, url: `note://settings/custom/${relative.split('/').map(encodeURIComponent).join('/')}` }; }
    catch { return { apiVersion: 1, kind: 'default', url: DEFAULT_URL, diagnostic: 'The selected settings note is unavailable. Showing the default interface.' }; }
  }
  return { get, set };
}
function resolveSettingsAsset(url, workspace, appRoot, selection, options = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'note:' || parsed.hostname !== 'settings') throw new Error('Invalid settings origin');
  const relative = decodeURIComponent(parsed.pathname).replace(/^\//, '');
  if (relative.startsWith('default/')) {
    let asset = relative.slice(8), ui = options.ui;
    const first = asset.split('/')[0];
    if (/^[a-f0-9]{64}$/.test(first)) { ui = options.snapshots?.get(first); asset = asset.slice(first.length + 1); if (!ui) throw new Error('Unknown settings UI snapshot'); }
    if (ui) {
      if (!ui.files.includes(asset)) throw new Error('Undeclared settings UI asset');
      return resolveInside(ui.directory, asset);
    }
    return resolveInside(path.join(appRoot, 'src/project-settings/ui'), asset);
  }
  if (relative.startsWith('assets/')) {
    if (relative === 'assets/project-settings.js' && options.ui) {
      if (!options.ui.files.includes('renderer.js')) throw new Error('Settings UI has no renderer library');
      return resolveInside(options.ui.directory, 'renderer.js');
    }
    const assets = { 'project-settings.js': 'src/project-settings/ui/renderer.js', 'marked.min.js': 'node_modules/marked/lib/marked.umd.js', 'purify.min.js': 'node_modules/dompurify/dist/purify.min.js' };
    if (!assets[relative.slice(7)]) throw new Error('Unknown settings asset');
    return resolveInside(appRoot, assets[relative.slice(7)]);
  }
  if (relative.startsWith('custom/') && selection.kind === 'custom') return resolveInside(workspace, relative.slice(7));
  throw new Error('Unknown settings route');
}
function rewriteSettingsLibraryLinks(html, files) {
  return html.replace(/\b(src|href)=(['"])([^'"]+)\2/gi, (attribute, name, quote, value) => {
    const match = value.match(/^((?:\.\/)?[^?#]+)([?#].*)?$/);
    const relative = match?.[1].replace(/^\.\//, '');
    return files.includes(relative) ? `${name}=${quote}note://settings/default/${relative}${match[2] || ''}${quote}` : attribute;
  });
}
module.exports = { DEFAULT_URL, createSettingsSurfaceStore, resolveSettingsAsset, resolveInside, rewriteSettingsLibraryLinks };
