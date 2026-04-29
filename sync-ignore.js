'use strict';

const fs = require('fs');
const path = require('path');
const ignore = require('ignore');

const SYNCIGNORE_FILE = '.syncignore';

const DEFAULT_SYNCIGNORE_ENTRIES = [
  '.git/',
  '.gitignore',
  '.notes-app/',
  'node_modules/',
  '.syncignore',
  '.DS_Store',
  '*.conflict.*',
];

const SYNCIGNORE_HEADER = '# Sync ignore rules (SSH & AWS sync)';

// ─── Content type detection ───────────────────────────────────────────────────

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.htm':  'text/html',
  '.css':  'text/css',
  '.js':   'text/javascript',
  '.json': 'application/json',
  '.txt':  'text/plain',
  '.csv':  'text/csv',
  '.xml':  'application/xml',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.pdf':  'application/pdf',
  '.zip':  'application/zip',
  '.mp3':  'audio/mpeg',
  '.mp4':  'video/mp4',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
  '.wasm': 'application/wasm',
  '.bin':  'application/octet-stream',
  '.md':   'text/markdown',
};

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

// ─── Load ignore instance ─────────────────────────────────────────────────────

function loadIgnore(workspacePath) {
  const ig = ignore();
  // Always add hardcoded defaults
  ig.add(DEFAULT_SYNCIGNORE_ENTRIES);

  // Layer user's .syncignore on top
  const syncignorePath = path.join(workspacePath, SYNCIGNORE_FILE);
  try {
    const content = fs.readFileSync(syncignorePath, 'utf8');
    ig.add(content);
  } catch {
    // No .syncignore file — defaults only
  }

  return ig;
}

// ─── Ensure .syncignore exists ────────────────────────────────────────────────

function ensureSyncignore(workspacePath) {
  const syncignorePath = path.join(workspacePath, SYNCIGNORE_FILE);

  let exists = false;
  let content = '';
  try {
    content = fs.readFileSync(syncignorePath, 'utf8');
    exists = true;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  if (!exists) {
    const fileContent = SYNCIGNORE_HEADER + '\n' + DEFAULT_SYNCIGNORE_ENTRIES.join('\n') + '\n';
    fs.writeFileSync(syncignorePath, fileContent, 'utf8');
    return { created: true, entriesAdded: [...DEFAULT_SYNCIGNORE_ENTRIES] };
  }

  // Parse existing entries
  const existingNormalized = new Set(
    content.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'))
      .map(l => l.replace(/\/$/, ''))
  );

  const missing = DEFAULT_SYNCIGNORE_ENTRIES.filter(
    entry => !existingNormalized.has(entry.replace(/\/$/, ''))
  );

  if (missing.length === 0) {
    return { created: false, entriesAdded: [] };
  }

  const prefix = content.endsWith('\n') ? '' : '\n';
  const appendContent = prefix + SYNCIGNORE_HEADER + '\n' + missing.join('\n') + '\n';
  fs.appendFileSync(syncignorePath, appendContent, 'utf8');
  return { created: false, entriesAdded: missing };
}

module.exports = {
  loadIgnore,
  ensureSyncignore,
  contentType,
  SYNCIGNORE_FILE,
};
