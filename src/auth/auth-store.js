'use strict';

const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

function _tokensPath() {
  return path.join(app.getPath('userData'), 'auth-tokens.enc');
}

function isEncryptionAvailable() {
  return safeStorage.isEncryptionAvailable();
}

/**
 * Save tokens to disk, encrypted with safeStorage.
 * @param {{ accessToken, idToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt }} tokens
 */
function saveTokens(tokens) {
  const json = JSON.stringify(tokens);
  const encrypted = safeStorage.encryptString(json);
  const filePath = _tokensPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encrypted);
}

/**
 * Load tokens from disk, decrypting with safeStorage.
 * Returns null if file doesn't exist or decryption fails.
 */
function loadTokens() {
  const filePath = _tokensPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const encrypted = fs.readFileSync(filePath);
    const json = safeStorage.decryptString(encrypted);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Delete the tokens file.
 */
function clearTokens() {
  const filePath = _tokensPath();
  try { fs.unlinkSync(filePath); } catch {}
}

module.exports = { isEncryptionAvailable, saveTokens, loadTokens, clearTokens };
