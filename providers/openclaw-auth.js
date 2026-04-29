'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const CONFIG_PATH = path.join(OPENCLAW_DIR, 'openclaw.json');
const DEVICE_PATH = path.join(OPENCLAW_DIR, 'identity', 'device.json');
const DEVICE_AUTH_PATH = path.join(OPENCLAW_DIR, 'identity', 'device-auth.json');
const PAIRED_PATH = path.join(OPENCLAW_DIR, 'devices', 'paired.json');

/**
 * Read the OpenClaw auth token from ~/.openclaw/openclaw.json.
 * Returns the token string, or null if missing/unreadable/malformed.
 * No caching — re-read on each call so token updates take effect.
 */
function readOpenClawToken() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw);
    const token = config?.gateway?.auth?.token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Read the OpenClaw gateway WebSocket URL from config.
 * Falls back to ws://127.0.0.1:18789 if not configured.
 */
function readOpenClawGatewayUrl() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw);
    const port = config?.gateway?.port;
    let bind = config?.gateway?.bind || '127.0.0.1';
    if (bind === 'loopback' || bind === 'localhost') bind = '127.0.0.1';
    if (port) return `ws://${bind}:${port}`;
  } catch {
    // fall through to default
  }
  return 'ws://127.0.0.1:18789';
}

/**
 * Read the OpenClaw device identity from ~/.openclaw/identity/device.json.
 * Returns { deviceId, privateKeyPem, publicKeyPem } or null.
 */
function readOpenClawDeviceIdentity() {
  try {
    const raw = fs.readFileSync(DEVICE_PATH, 'utf8');
    const device = JSON.parse(raw);
    if (device.deviceId && device.privateKeyPem && device.publicKeyPem) {
      return device;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the OpenClaw device auth token from ~/.openclaw/identity/device-auth.json.
 * Returns the operator device token string, or null.
 */
function readOpenClawDeviceToken() {
  try {
    const raw = fs.readFileSync(DEVICE_AUTH_PATH, 'utf8');
    const auth = JSON.parse(raw);
    const token = auth?.tokens?.operator?.token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Read the paired device metadata for this device from ~/.openclaw/devices/paired.json.
 * Returns { clientId, clientMode, platform, scopes } or defaults.
 */
function readOpenClawPairedMetadata(deviceId) {
  try {
    const raw = fs.readFileSync(PAIRED_PATH, 'utf8');
    const paired = JSON.parse(raw);
    const entry = paired[deviceId];
    if (entry) {
      return {
        clientId: entry.clientId || 'cli',
        clientMode: entry.clientMode || 'cli',
        platform: entry.platform || process.platform,
        scopes: entry.scopes || ['operator.read', 'operator.write'],
      };
    }
  } catch {
    // fall through to defaults
  }
  return {
    clientId: 'cli',
    clientMode: 'cli',
    platform: process.platform,
    scopes: ['operator.read', 'operator.write'],
  };
}

module.exports = {
  readOpenClawToken,
  readOpenClawGatewayUrl,
  readOpenClawDeviceIdentity,
  readOpenClawDeviceToken,
  readOpenClawPairedMetadata,
};
