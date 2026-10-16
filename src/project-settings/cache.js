'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateCatalog } = require('./service');

// Catalogs come from the app's content archive, never from editable project files.
const MAX_RESOURCE_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 8 * MAX_RESOURCE_BYTES;
const UI_MANIFEST = 'ui/manifest.json';
function resourcePath(relative) {
  return typeof relative === 'string' && relative.length > 0 && relative.length <= 512 && !relative.includes('\\') && !relative.includes('\0') && !path.isAbsolute(relative) && !/^[a-z]:/i.test(relative) && relative.split('/').every(part => part && part !== '.' && part !== '..');
}
function readPackage(directory) {
  const root = fs.realpathSync(directory);
  const files = new Map();
  let totalBytes = 0;
  function readText(relative) {
    if (!resourcePath(relative)) throw new Error('Invalid settings resource path');
    if (files.has(relative)) return files.get(relative);
    let target = root;
    for (const part of relative.split('/')) {
      target = path.join(target, part);
      if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Catalog resources cannot be symbolic links');
    }
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > MAX_RESOURCE_BYTES) throw new Error('Invalid catalog resource size or type');
    totalBytes += stat.size;
    if (totalBytes > MAX_PACKAGE_BYTES) throw new Error('Settings package exceeds 8 MiB');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(target));
    if (content.includes('\0')) throw new Error('Settings resources must be text');
    files.set(relative, content);
    return content;
  }
  const catalog = JSON.parse(readText('catalog.json'));
  const diagnostics = validateCatalog(catalog);
  if (diagnostics.length) throw new Error(diagnostics.map(d => `${d.path}: ${d.message}`).join('; '));
  for (const definition of catalog.definitions) {
    if (definition.schema && !files.has(definition.schema)) {
      const schema = JSON.parse(readText(definition.schema));
      if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('Expected schema object');
    }
  }
  // Official note exclusions travel atomically with the existing settings package.
  // Older packages omit the resource and use the bundled fallback.
  const { RESOURCE_NAME, validateOfficialExclusions } = require('../project-model/official-exclusions');
  let hasExclusions = false;
  try { fs.lstatSync(path.join(root, RESOURCE_NAME)); hasExclusions = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (hasExclusions) validateOfficialExclusions(JSON.parse(readText(RESOURCE_NAME)));
  let hasUI = false;
  try { fs.lstatSync(path.join(root, 'ui')); hasUI = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (hasUI) {
    const manifest = JSON.parse(readText(UI_MANIFEST));
    if (!manifest || manifest.version !== 1 || manifest.apiVersion !== 1 || typeof manifest.minAppVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.minAppVersion) || Object.keys(manifest).some(key => !['version', 'apiVersion', 'minAppVersion', 'files'].includes(key))) throw new Error('Unsupported settings UI manifest');
    if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 100 || new Set(manifest.files).size !== manifest.files.length || !manifest.files.includes('index.html')) throw new Error('Invalid settings UI files');
    for (const relative of manifest.files) {
      if (!resourcePath(relative) || !/\.(?:html?|css|js|json|svg|txt|map)$/.test(relative) || relative === 'manifest.json') throw new Error('Invalid settings UI asset path or type');
      readText(`ui/${relative}`);
    }
  }
  return files;
}

function cacheRoot(userDataPath) { return path.join(userDataPath, 'project-settings-catalogs'); }

// Return the persisted pointer for inspection; startup must use selectCatalog.
function getCachedCatalog(userDataPath) {
  try {
    const root = cacheRoot(userDataPath);
    const pointer = JSON.parse(fs.readFileSync(path.join(root, 'current.json'), 'utf8'));
    if (typeof pointer.hash !== 'string' || !/^[a-f0-9]{64}$/.test(pointer.hash)) return undefined;
    const directory = path.join(root, pointer.hash);
    readPackage(directory);
    return path.join(directory, 'catalog.json');
  } catch { return undefined; }
}

// Legacy catalogs have revision zero. Equal revisions prefer the bundled copy,
// so a previously downloaded catalog cannot shadow an application update.
function compatible(catalog, appVersion) {
  if (!catalog.minAppVersion) return true;
  const minimum = catalog.minAppVersion.split('.').map(Number);
  const current = appVersion.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (current[i] !== minimum[i]) return current[i] > minimum[i];
  }
  return true;
}
function candidate(directory, appVersion) {
  const files = readPackage(directory);
  const catalog = JSON.parse(files.get('catalog.json'));
  const ui = files.has(UI_MANIFEST) ? JSON.parse(files.get(UI_MANIFEST)) : null;
  return {files, path:path.join(directory,'catalog.json'), revision:catalog.revision || 0, compatible:compatible(catalog,appVersion) && (!ui || compatible(ui,appVersion))};
}
function selectionOptions(options = {}) {
  return {bundledDirectory: options.bundledDirectory || __dirname, appVersion: options.appVersion || require('../../package.json').version};
}
function selectCatalog(userDataPath, options) {
  const {bundledDirectory,appVersion} = selectionOptions(options);
  let best;
  const seen = new Set();
  const consider = directory => {
    const identity = path.resolve(directory);
    if (seen.has(identity)) return;
    seen.add(identity);
    try { const next = candidate(directory,appVersion); if (next.compatible && (!best || next.revision > best.revision)) best = next; }
    catch { /* Incomplete or invalid packages never replace a usable catalog. */ }
  };
  consider(bundledDirectory);
  // Inspect retained caches as well: an app downgrade may leave current.json
  // pointing at a catalog that requires a newer application.
  const current = getCachedCatalog(userDataPath);
  if (current) consider(path.dirname(current));
  try {
    for (const entry of fs.readdirSync(cacheRoot(userDataPath),{withFileTypes:true})) {
      if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) consider(path.join(cacheRoot(userDataPath),entry.name));
    }
  } catch { /* A fresh installation has no cache. */ }
  if (!best) throw new Error('No valid, compatible settings catalog is available');
  return best.path;
}

function installCatalogCache(sourceDirectory, userDataPath, options) {
  const settings = selectionOptions(options);
  const incoming = candidate(sourceDirectory,settings.appVersion);
  const activePath = selectCatalog(userDataPath,settings);
  const active = candidate(path.dirname(activePath),settings.appVersion);
  if (!incoming.compatible || incoming.revision <= active.revision) return activePath;
  const files = incoming.files;
  const hash = crypto.createHash('sha256').update(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
  const root = cacheRoot(userDataPath);
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, hash);
  const staging = path.join(root, `.stage-${crypto.randomUUID()}`);
  try {
    fs.mkdirSync(staging);
    for (const [relative, text] of files) {
      const output = path.join(staging, relative);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, text, { flag: 'wx' });
    }
    readPackage(staging);
    if (fs.existsSync(target)) {
      readPackage(target);
      fs.rmSync(staging, { recursive: true });
    } else fs.renameSync(staging, target);
    const pointerTemp = path.join(root, `.current-${crypto.randomUUID()}.json`);
    try {
      fs.writeFileSync(pointerTemp, JSON.stringify({ hash }), { flag: 'wx' });
      fs.renameSync(pointerTemp, path.join(root, 'current.json'));
    } finally { fs.rmSync(pointerTemp, { force: true }); }
    return path.join(target, 'catalog.json');
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}

// Only application-distributed packages are eligible. Editable project catalogs
// are deliberately absent from this selection path.
function selectSettingsUI(userDataPath, options) {
  const settings = selectionOptions(options);
  const catalogPath = selectCatalog(userDataPath, settings);
  const selected = candidate(path.dirname(catalogPath), settings.appVersion);
  const bundled = selected.files.has(UI_MANIFEST) ? selected : candidate(settings.bundledDirectory, settings.appVersion);
  if (!bundled.compatible || !bundled.files.has(UI_MANIFEST)) throw new Error('No valid, compatible settings UI is available');
  const manifest = JSON.parse(bundled.files.get(UI_MANIFEST));
  const contents = new Map(manifest.files.map(file => [file, bundled.files.get(`ui/${file}`)]));
  const hash = crypto.createHash('sha256').update(JSON.stringify([...contents].sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
  return { directory: path.join(path.dirname(bundled.path), 'ui'), files: [...manifest.files], hash, catalogPath, revision: selected.revision };
}

module.exports = { getCachedCatalog, selectCatalog, installCatalogCache, selectSettingsUI, readSettingsPackage: readPackage };
