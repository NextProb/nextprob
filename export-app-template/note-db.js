'use strict';

const fs = require('fs');
const path = require('path');

const noteDbCache = new Map();

function noteDbPath(notePath, noteId) {
  if (!notePath) return null;
  return path.join(notePath, 'storage', 'kv.json');
}

function noteDbLoad(notePath, noteId) {
  if (noteDbCache.has(noteId)) return noteDbCache.get(noteId);
  const kvPath = noteDbPath(notePath, noteId);
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

function noteDbFlush(notePath, noteId, data) {
  const kvPath = noteDbPath(notePath, noteId);
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

function clearCache() {
  noteDbCache.clear();
}

module.exports = { noteDbCache, noteDbPath, noteDbLoad, noteDbFlush, clearCache };
