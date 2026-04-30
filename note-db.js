'use strict';

// note-db.js — noteDB KV store helpers (feature 94, extracted for feature 144)
// Manages per-note kv.json files under <workspace>/<noteId>/storage/kv.json.
// Callers pass workspacePath explicitly so this module has no module-level workspace state.

const fs = require('fs');
const path = require('path');

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
 * Read the KV store for a note from disk. Always hits the filesystem so external
 * edits to kv.json are picked up immediately.
 */
function noteDbLoad(workspacePath, noteId) {
  const kvPath = noteDbPath(workspacePath, noteId);
  if (!kvPath || !fs.existsSync(kvPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(kvPath, 'utf8'));
  } catch {
    return {};
  }
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

module.exports = { noteDbPath, noteDbLoad, noteDbFlush };
