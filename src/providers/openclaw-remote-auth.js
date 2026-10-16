'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

function getRemotesDir() {
  return path.join(app.getPath('userData'), 'openclaw-remotes');
}

function getEndpointDir(endpointId) {
  return path.join(getRemotesDir(), endpointId);
}

/**
 * Generate a new Ed25519 device identity (keypair + UUID).
 * Uses Node.js built-in crypto (available since Node v15; Electron 33 ships Node v20+).
 * Returns { deviceId, privateKeyPem, publicKeyPem }.
 */
function generateDeviceIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const deviceId = crypto.randomUUID();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  return { deviceId, privateKeyPem, publicKeyPem };
}

function readRemoteDeviceIdentity(endpointId) {
  try {
    const raw = fs.readFileSync(path.join(getEndpointDir(endpointId), 'device.json'), 'utf8');
    const obj = JSON.parse(raw);
    if (obj.deviceId && obj.privateKeyPem && obj.publicKeyPem) return obj;
    return null;
  } catch { return null; }
}

function writeRemoteDeviceIdentity(endpointId, identity) {
  const dir = getEndpointDir(endpointId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify(identity, null, 2));
}

function readRemoteDeviceToken(endpointId) {
  try {
    const raw = fs.readFileSync(path.join(getEndpointDir(endpointId), 'device-auth.json'), 'utf8');
    const auth = JSON.parse(raw);
    const token = auth?.tokens?.operator?.token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch { return null; }
}

function writeRemoteDeviceToken(endpointId, token) {
  const dir = getEndpointDir(endpointId);
  fs.mkdirSync(dir, { recursive: true });
  const auth = { tokens: { operator: { token } } };
  fs.writeFileSync(path.join(dir, 'device-auth.json'), JSON.stringify(auth, null, 2));
}

function readRemotePairedMetadata(endpointId) {
  try {
    const raw = fs.readFileSync(path.join(getEndpointDir(endpointId), 'paired.json'), 'utf8');
    const obj = JSON.parse(raw);
    if (obj) return {
      clientId: obj.clientId || 'cli',
      clientMode: obj.clientMode || 'cli',
      platform: obj.platform || process.platform,
      scopes: obj.scopes || ['operator.read', 'operator.write'],
    };
  } catch {}
  return {
    clientId: 'cli',
    clientMode: 'cli',
    platform: process.platform,
    scopes: ['operator.read', 'operator.write'],
  };
}

function writeRemotePairedMetadata(endpointId, meta) {
  const dir = getEndpointDir(endpointId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'paired.json'), JSON.stringify(meta, null, 2));
}

/**
 * Save the gateway token encrypted with safeStorage.
 * Stored as binary at {userData}/openclaw-remotes/{id}/token.enc
 */
function writeRemoteGatewayToken(endpointId, token) {
  if (!token || typeof token !== 'string') return;
  const dir = getEndpointDir(endpointId);
  fs.mkdirSync(dir, { recursive: true });
  const encrypted = safeStorage.encryptString(token);
  fs.writeFileSync(path.join(dir, 'token.enc'), encrypted);
}

/**
 * Read and decrypt the gateway token.
 * Returns the plaintext token string, or null if missing/unreadable.
 */
function readRemoteGatewayToken(endpointId) {
  try {
    const encrypted = fs.readFileSync(path.join(getEndpointDir(endpointId), 'token.enc'));
    return safeStorage.decryptString(encrypted);
  } catch { return null; }
}

/**
 * Save SSH password encrypted with safeStorage.
 * Stored as binary at {userData}/openclaw-remotes/{id}/ssh-password.enc
 */
function writeRemoteSshPassword(endpointId, password) {
  if (!password || typeof password !== 'string') return;
  const dir = getEndpointDir(endpointId);
  fs.mkdirSync(dir, { recursive: true });
  const encrypted = safeStorage.encryptString(password);
  fs.writeFileSync(path.join(dir, 'ssh-password.enc'), encrypted);
}

/**
 * Read and decrypt the SSH password.
 * Returns the plaintext password string, or null if missing/unreadable.
 */
function readRemoteSshPassword(endpointId) {
  try {
    const encrypted = fs.readFileSync(path.join(getEndpointDir(endpointId), 'ssh-password.enc'));
    return safeStorage.decryptString(encrypted);
  } catch { return null; }
}

function deleteRemoteCredentials(endpointId) {
  try {
    fs.rmSync(getEndpointDir(endpointId), { recursive: true, force: true });
  } catch {}
}

module.exports = {
  getRemotesDir,
  getEndpointDir,
  generateDeviceIdentity,
  readRemoteDeviceIdentity,
  writeRemoteDeviceIdentity,
  readRemoteDeviceToken,
  writeRemoteDeviceToken,
  readRemotePairedMetadata,
  writeRemotePairedMetadata,
  writeRemoteGatewayToken,
  readRemoteGatewayToken,
  writeRemoteSshPassword,
  readRemoteSshPassword,
  deleteRemoteCredentials,
};
