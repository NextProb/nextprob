'use strict';
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

function getSyncDir() {
  return path.join(app.getPath('userData'), 'ssh-sync');
}

function getEndpointDir(endpointId) {
  return path.join(getSyncDir(), endpointId);
}

function writeSshPassword(endpointId, password) {
  if (!password || typeof password !== 'string') return;
  const dir = getEndpointDir(endpointId);
  fs.mkdirSync(dir, { recursive: true });
  const encrypted = safeStorage.encryptString(password);
  fs.writeFileSync(path.join(dir, 'ssh-password.enc'), encrypted);
}

function readSshPassword(endpointId) {
  try {
    const encrypted = fs.readFileSync(path.join(getEndpointDir(endpointId), 'ssh-password.enc'));
    return safeStorage.decryptString(encrypted);
  } catch { return null; }
}

function deleteEndpointData(endpointId) {
  try {
    fs.rmSync(getEndpointDir(endpointId), { recursive: true, force: true });
  } catch {}
}

module.exports = {
  getSyncDir,
  getEndpointDir,
  writeSshPassword,
  readSshPassword,
  deleteEndpointData,
};
