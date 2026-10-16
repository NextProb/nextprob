'use strict';

const path = require('path');
const chokidar = require('chokidar');
const fs = require('fs');
const { TECHNICAL_NAMES } = require('./catalog');

/** Watch discovery inputs independently of legacy sync and display exclusions. */
function createCatalogWatcher(workspacePath, onChange) {
  const root = path.resolve(workspacePath);
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    followSymlinks: false,
    ignored(candidate, stats) {
      const relative = path.relative(root, candidate);
      if (!relative) return false;
      if (relative === path.join('.claude', 'skills') || relative.startsWith(path.join('.claude', 'skills') + path.sep)) return true;
      const segments = relative.split(path.sep);
      if (stats?.isSymbolicLink()) return true;
      const storage = segments.indexOf('storage');
      if (storage >= 0) {
        // Traverse storage only to observe a note's KV input, never its other contents.
        if (storage === 0 || segments.slice(0, storage).some(segment => TECHNICAL_NAMES.has(segment))) return true;
        if (segments.length > storage + 2 || (segments.length === storage + 2 && segments.at(-1) !== 'kv.json')) return true;
        // The store may arrive before index.html during import or sync.
        return false;
      }
      return segments.some(segment => TECHNICAL_NAMES.has(segment));
    },
  });
  watcher.on('all', (event, absolutePath) => {
    const segments = path.relative(root, absolutePath).split(path.sep);
    if (segments.includes('storage')) {
      const filename = segments.at(-1) === 'storage' ? path.join(absolutePath, 'kv.json') : absolutePath;
      // Storage directory creation itself carries no metadata yet.
      if (event === 'addDir') return;
      try { if (!fs.lstatSync(path.join(path.dirname(path.dirname(filename)), 'index.html')).isFile()) return; }
      catch { return; }
    }
    onChange(event, absolutePath);
  });
  return watcher;
}

module.exports = { createCatalogWatcher };
