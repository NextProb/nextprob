const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DIR_NAME = '.context';

function contextDir(workspacePath) {
  return path.join(workspacePath, DIR_NAME);
}

function ensureDir(workspacePath) {
  const dir = contextDir(workspacePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Atomic write: write to tmp file then rename to avoid partial reads by consumers. */
function atomicWrite(filePath, data) {
  const tmp = filePath + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}

function writeQuotes(workspacePath, items) {
  const dir = ensureDir(workspacePath);
  atomicWrite(path.join(dir, 'quotes.json'), {
    updatedAt: new Date().toISOString(),
    items: items.map(i => ({ text: i.content, path: i.path, noteTitle: i.noteTitle })),
  });
}

function writeCurrentNote(workspacePath, noteInfo) {
  const dir = ensureDir(workspacePath);
  if (noteInfo) {
    atomicWrite(path.join(dir, 'current-note.json'), {
      updatedAt: new Date().toISOString(),
      active: true,
      path: noteInfo.path,
      noteTitle: noteInfo.noteTitle,
      noteId: noteInfo.noteId,
    });
  } else {
    atomicWrite(path.join(dir, 'current-note.json'), {
      updatedAt: new Date().toISOString(),
      active: false,
      path: null,
      noteTitle: null,
      noteId: null,
    });
  }
}

function writeMeta(workspacePath) {
  const dir = ensureDir(workspacePath);
  atomicWrite(path.join(dir, 'meta.json'), {
    updatedAt: new Date().toISOString(),
    app: 'toutkit',
    pid: process.pid,
    workspacePath,
  });
}

function clearAll(workspacePath) {
  const dir = contextDir(workspacePath);
  if (!fs.existsSync(dir)) return;
  for (const file of ['quotes.json', 'current-note.json', 'meta.json']) {
    const fp = path.join(dir, file);
    try { fs.unlinkSync(fp); } catch { /* ignore */ }
  }
}

module.exports = { contextDir, ensureDir, writeQuotes, writeCurrentNote, writeMeta, clearAll };
