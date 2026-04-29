'use strict';

// note-db.js — noteDB KV store helpers (feature 94, extracted for feature 144)
// Manages per-note kv.json files under <workspace>/<noteId>/storage/kv.json.
// Callers pass workspacePath explicitly so this module has no module-level workspace state.

const fs = require('fs');
const path = require('path');

// In-memory cache: Map<noteId, object>
const noteDbCache = new Map();

/**
 * Resolve and validate the kv.json path for a note.
 * Returns null if workspacePath is not set or noteId is a path-traversal attempt.
 */
function noteDbPath(workspacePath, noteId) {
  if (!workspacePath) return null;
  const kvPath = path.resolve(path.join(workspacePath, noteId, 'storage', 'kv.json'));
  if (!kvPath.startsWith(workspacePath + path.sep)) return null;
  return kvPath;
}

/**
 * Load the KV store for a note into cache (if not already loaded). Returns the cache entry.
 */
function noteDbLoad(workspacePath, noteId) {
  if (noteDbCache.has(noteId)) return noteDbCache.get(noteId);
  const kvPath = noteDbPath(workspacePath, noteId);
  let data = {};
  if (kvPath && fs.existsSync(kvPath)) {
    try {
      data = JSON.parse(fs.readFileSync(kvPath, 'utf8'));
    } catch {
      data = {};
    }
  }
  noteDbCache.set(noteId, data);
  return data;
}

/**
 * Atomically write the KV data to disk.
 * Writes to a .tmp file first, then renames — atomic on macOS/Linux.
 */
function noteDbFlush(workspacePath, noteId, data) {
  const kvPath = noteDbPath(workspacePath, noteId);
  if (!kvPath) throw new Error('Invalid noteId');
  const dir = path.dirname(kvPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = kvPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, kvPath);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

/**
 * Clear the in-memory cache (call on workspace switch).
 */
function clearCache() {
  noteDbCache.clear();
}

module.exports = { noteDbCache, noteDbPath, noteDbLoad, noteDbFlush, clearCache };
