'use strict';

const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

function _path() {
  return path.join(app.getPath('userData'), 'github-auth.enc');
}

function isEncryptionAvailable() {
  return safeStorage.isEncryptionAvailable();
}

/**
 * Persist the GitHub session to disk, encrypted with safeStorage.
 * @param {{ accessToken: string, scopes: string[], user: { login, id, avatarUrl }, repoName?: string }} session
 */
function save(session) {
  const encrypted = safeStorage.encryptString(JSON.stringify(session));
  const filePath = _path();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encrypted);
}

/**
 * Load the GitHub session from disk. Returns null if absent or undecryptable.
 */
function load() {
  const filePath = _path();
  if (!fs.existsSync(filePath)) return null;
  try {
    const encrypted = fs.readFileSync(filePath);
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch {
    return null;
  }
}

function clear() {
  try { fs.unlinkSync(_path()); } catch {}
}

module.exports = { isEncryptionAvailable, save, load, clear };
