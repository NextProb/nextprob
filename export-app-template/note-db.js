'use strict';

const fs = require('fs');
const path = require('path');

function noteDbPath(notePath, noteId) {
  if (!notePath) return null;
  return path.join(notePath, 'storage', 'kv.json');
}

function noteDbLoad(notePath, noteId) {
  const kvPath = noteDbPath(notePath, noteId);
  if (!kvPath || !fs.existsSync(kvPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(kvPath, 'utf8'));
  } catch {
    return {};
  }
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

module.exports = { noteDbPath, noteDbLoad, noteDbFlush };
