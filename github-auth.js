'use strict';

// GitHub OAuth Device Flow + token storage for the gist-backed sharing feature.
// Companion to auth.js (which handles the toutkit/Cognito session). Lives separately
// because the two identities are independent: a user is either signed into toutkit,
// signed into GitHub, both, or neither.

const { shell } = require('electron');
const https = require('https');
const { URL, URLSearchParams } = require('url');
const store = require('./github-auth-store');

const _configAll = require('./auth-config.json');
const _stage = process.env.APP_STAGE || 'dev';
const _config = _configAll[_stage];
const CLIENT_ID = _config && _config.githubClientId;
const SCOPES = 'gist,public_repo';
const USER_AGENT = 'ToutKit-Notes';

let _session = null;          // { accessToken, scopes, user, repoName? }
let _connecting = null;       // { deviceCode, userCode, verificationUri, expiresAt, intervalMs, pollTimer }
let _listeners = [];

function onStateChanged(cb) { _listeners.push(cb); }
function _notify() {
  const state = getState();
  for (const cb of _listeners) { try { cb(state); } catch {} }
}

// ─── HTTPS helpers ───────────────────────────────────────────────────────────

function _request(method, urlStr, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isJsonBody = body && typeof body === 'object' && !(body instanceof Buffer);
    const payload = isJsonBody ? JSON.stringify(body) : body;
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': isJsonBody ? 'application/json' : 'application/x-www-form-urlencoded' } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = data;
        const ct = res.headers['content-type'] || '';
        if (ct.includes('application/json')) { try { parsed = JSON.parse(data); } catch {} }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  if (!store.isEncryptionAvailable()) return;
  _session = store.load();
}

// ─── Device Flow ──────────────────────────────────────────────────────────────

/**
 * Begin Device Flow. Opens the verification URL in the user's browser
 * (with user_code prefilled) and starts polling for completion.
 * Returns the displayable details immediately so the renderer can show them.
 */
async function startConnect() {
  if (!CLIENT_ID) throw new Error('githubClientId missing from auth-config');
  if (_connecting) cancelConnect();

  const r = await _request('POST', 'https://github.com/login/device/code', {
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (r.status !== 200 || !r.body || !r.body.device_code) {
    throw new Error('Could not start GitHub authentication.');
  }

  const { device_code, user_code, verification_uri, expires_in, interval } = r.body;
  _connecting = {
    deviceCode: device_code,
    userCode: user_code,
    verificationUri: verification_uri,
    expiresAt: Date.now() + expires_in * 1000,
    intervalMs: Math.max(5, interval || 5) * 1000,
    pollTimer: null,
  };

  const browserUrl = `${verification_uri}?user_code=${encodeURIComponent(user_code)}`;
  shell.openExternal(browserUrl).catch(() => {});

  _schedulePoll();
  _notify();

  return {
    userCode: user_code,
    verificationUri: verification_uri,
    verificationUriComplete: browserUrl,
    expiresAt: _connecting.expiresAt,
  };
}

function cancelConnect() {
  if (!_connecting) return;
  if (_connecting.pollTimer) clearTimeout(_connecting.pollTimer);
  _connecting = null;
  _notify();
}

function _schedulePoll() {
  if (!_connecting) return;
  _connecting.pollTimer = setTimeout(_poll, _connecting.intervalMs);
}

async function _poll() {
  if (!_connecting) return;
  if (Date.now() > _connecting.expiresAt) {
    _connecting = null;
    _notify({ error: 'expired' });
    return;
  }

  let res;
  try {
    res = await _request('POST', 'https://github.com/login/oauth/access_token', {
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        device_code: _connecting.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    _schedulePoll();
    return;
  }

  const body = res.body || {};

  if (body.error === 'authorization_pending') {
    _schedulePoll();
    return;
  }
  if (body.error === 'slow_down') {
    // GitHub asks us to back off — its `interval` value is authoritative.
    if (body.interval) _connecting.intervalMs = body.interval * 1000;
    _schedulePoll();
    return;
  }
  if (body.error === 'expired_token' || body.error === 'access_denied') {
    _connecting = null;
    _notify({ error: body.error });
    return;
  }

  if (body.access_token) {
    const accessToken = body.access_token;
    const scopes = (body.scope || '').split(',').map((s) => s.trim()).filter(Boolean);
    let user = null;
    try {
      const u = await _request('GET', 'https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (u.status === 200 && u.body && u.body.login) {
        user = { login: u.body.login, id: u.body.id, avatarUrl: u.body.avatar_url };
      }
    } catch {}

    if (!user) {
      _connecting = null;
      _notify({ error: 'user_lookup_failed' });
      return;
    }

    _session = { accessToken, scopes, user };
    if (store.isEncryptionAvailable()) store.save(_session);
    _connecting = null;
    _notify();
    return;
  }

  // Unknown response — treat as transient and keep polling until expiry.
  _schedulePoll();
}

// ─── Disconnect ───────────────────────────────────────────────────────────────

function disconnect() {
  cancelConnect();
  _session = null;
  store.clear();
  _notify();
}

// ─── Public getters / setters ─────────────────────────────────────────────────

function isConnected() { return !!(_session && _session.accessToken); }

function getUser() { return _session ? _session.user : null; }

function getAccessToken() { return _session ? _session.accessToken : null; }

function getRepoName() { return _session ? (_session.repoName || null) : null; }

function setRepoName(name) {
  if (!_session) throw new Error('Not connected to GitHub');
  _session = { ..._session, repoName: name };
  if (store.isEncryptionAvailable()) store.save(_session);
  _notify();
}

function getState() {
  if (_connecting) {
    return {
      status: 'connecting',
      userCode: _connecting.userCode,
      verificationUri: _connecting.verificationUri,
      verificationUriComplete: `${_connecting.verificationUri}?user_code=${encodeURIComponent(_connecting.userCode)}`,
      expiresAt: _connecting.expiresAt,
    };
  }
  if (_session) {
    return {
      status: 'connected',
      user: _session.user,
      repoName: _session.repoName || null,
    };
  }
  return { status: 'disconnected' };
}

/**
 * Make an authenticated request to api.github.com.
 * Used by github-api.js (gist + repo operations).
 */
async function apiRequest(method, path, opts = {}) {
  if (!_session || !_session.accessToken) throw new Error('Not connected to GitHub');
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  return _request(method, url, {
    body: opts.body,
    headers: {
      Authorization: `Bearer ${_session.accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
}

module.exports = {
  init,
  startConnect,
  cancelConnect,
  disconnect,
  isConnected,
  getUser,
  getAccessToken,
  getRepoName,
  setRepoName,
  getState,
  onStateChanged,
  apiRequest,
};
