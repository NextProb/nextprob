'use strict';

const fs = require('fs');
const path = require('path');
const { extractTitle } = require('../notes/note-title');
const { defaultMetadataReader, projectMetadata } = require('./metadata');

// These are discovery boundaries, not presentation preferences. In particular,
// templates and ordinary dot directories remain available to collections.
const TECHNICAL_NAMES = new Set([
  '.git', '.agents', 'node_modules', 'storage', '.notes-app',
  'nextprob.config.json',
]);
const NOTE_EXTENSIONS = new Set(['html', 'htm', 'md', 'txt']);

/** Build a project catalog without applying any surface's visibility rules. */
function buildCatalog(workspacePath, { favorites = [], metadataFields = {}, includePublication = false,
  metadataReader = defaultMetadataReader } = {}) {
  if (!workspacePath) return { tree: null, items: [] };
  const rootPath = path.resolve(workspacePath);
  const favoriteIndices = new Map();
  favorites.forEach((value, index) => {
    const normalized = String(value).replace(/\\/g, '/');
    if (!favoriteIndices.has(normalized)) favoriteIndices.set(normalized, index);
  });
  const items = [];
  const publishedNotes = {};
  const metadataDiagnostics = [];
  const needsMetadata = Object.keys(metadataFields).length > 0;

  function scan(directory) {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch { return []; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const children = [];
    for (const entry of entries) {
      if (TECHNICAL_NAMES.has(entry.name) || entry.isSymbolicLink()
        || (entry.name === 'skills' && directory === path.join(rootPath, '.claude'))) continue;
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const absolutePath = path.join(directory, entry.name);
      let stats;
      try { stats = fs.statSync(absolutePath); } catch { continue; }
      const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join('/');
      const segments = relativePath.split('/');
      const ancestorPaths = segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
      let folderNote = false;
      if (entry.isDirectory()) {
        try { folderNote = fs.lstatSync(path.join(absolutePath, 'index.html')).isFile(); } catch {}
      }
      const type = folderNote ? 'note' : entry.isDirectory() ? 'folder' : 'file';
      const extension = entry.isDirectory() ? '' : path.extname(entry.name).slice(1).toLowerCase();
      const isNote = folderNote || NOTE_EXTENSIONS.has(extension);
      const node = { name: entry.name, path: absolutePath, type, mtime: stats.mtimeMs };
      if (folderNote || extension === 'html' || extension === 'htm') {
        node.title = extractTitle(folderNote ? path.join(absolutePath, 'index.html') : absolutePath,
          folderNote ? entry.name : entry.name.replace(/\.(?:html?|htm)$/i, ''));
      }
      const item = {
        ...node, relativePath, kind: type, extension, ancestorPaths,
        title: node.title || entry.name, modifiedAt: stats.mtimeMs,
        favorite: favoriteIndices.has(relativePath),
        favoriteOrder: favoriteIndices.has(relativePath) ? favoriteIndices.get(relativePath) : null,
        capabilities: { open: type !== 'folder', createFromTemplate: folderNote || extension === 'html' || extension === 'htm' },
        isDirectory: entry.isDirectory(), isNote,
      };
      if (needsMetadata) item.metadata = projectMetadata({}, metadataFields);
      if (folderNote && (needsMetadata || includePublication)) {
        const { metadata, publication, error } = metadataReader.read(rootPath, relativePath, { metadataFields, includePublication });
        if (error) metadataDiagnostics.push({ path: `${relativePath}/storage/kv.json`, message: error });
        if (needsMetadata) item.metadata = metadata;
        if (includePublication && publication) publishedNotes[absolutePath] = publication;
      }
      items.push(item);
      if (type === 'folder') node.children = scan(absolutePath);
      children.push(node);
    }
    return children;
  }

  const tree = { name: path.basename(rootPath), path: rootPath, type: 'folder', children: scan(rootPath) };
  return { tree, items, metadataDiagnostics, ...(includePublication ? { publishedNotes } : {}) };
}

module.exports = { buildCatalog, TECHNICAL_NAMES };
