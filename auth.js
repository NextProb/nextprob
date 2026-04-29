'use strict';

const { app, shell } = require('electron');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL, URLSearchParams } = require('url');
const authStore = require('./auth-store');

// ─── Config ───────────────────────────────────────────────────────────────────

const _configAll = require('./auth-config.json');
const _stage = process.env.APP_STAGE || 'dev';
const _config = _configAll[_stage];

// ─── In-memory state ─────────────────────────────────────────────────────────

let _tokens = null;           // { accessToken, idToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt }
const _pendingStates = new Map();  // state → { timestamp, used } for CSRF protection
let _refreshTimer = null;
let _listeners = [];          // auth state change callbacks
let _encryptionUnavailable = false;
let _loopbackServer = null;  // local HTTP server for dev-mode OAuth callback

// ─── Event emitter ────────────────────────────────────────────────────────────

function onAuthStateChanged(callback) {
  _listeners.push(callback);
}

function _notifyListeners(user) {
  for (const cb of _listeners) {
    try { cb(user); } catch {}
  }
}

// ─── JWT decode ───────────────────────────────────────────────────────────────

function _decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// ─── HTTPS helper ─────────────────────────────────────────────────────────────

function _httpsPost(hostname, path, body, contentType = 'application/x-www-form-urlencoded') {
  return new Promise((resolve, reject) => {
    const postData = contentType === 'application/json'
      ? JSON.stringify(body)
      : new URLSearchParams(body).toString();
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function _cleanupOldStates() {
  const maxAge = 10 * 60 * 1000; // 10 minutes
  const now = Date.now();
  for (const [state, info] of _pendingStates.entries()) {
    if (now - info.timestamp > maxAge) {
      _pendingStates.delete(state);
    }
  }
}

function _validateState(state) {
  if (!state || !_pendingStates.has(state)) return false;
  const info = _pendingStates.get(state);
  if (info.used) return false;
  const maxAge = 10 * 60 * 1000;
  if (Date.now() - info.timestamp > maxAge) {
    _pendingStates.delete(state);
    return false;
  }
  return true;
}

// ─── Core auth functions ──────────────────────────────────────────────────────

/**
 * Initialize auth on app startup. Loads stored tokens, refreshes if needed.
 * Call once in app.whenReady().
 */
async function init() {
  if (!authStore.isEncryptionAvailable()) {
    _encryptionUnavailable = true;
    // Tokens can't be persisted — user stays logged out. Warning shown on first login attempt.
    return;
  }

  _tokens = authStore.loadTokens();
  if (!_tokens) return;

  const now = Date.now();

  // Refresh token expired → clear and stay logged out
  if (_tokens.refreshTokenExpiresAt && _tokens.refreshTokenExpiresAt < now) {
    authStore.clearTokens();
    _tokens = null;
    return;
  }

  // Access token expired but refresh token still valid → refresh now
  if (_tokens.accessTokenExpiresAt < now) {
    const ok = await _refreshAccessToken();
    if (!ok) return; // refresh failed, already logged out
  }

  // Tokens valid — start refresh timer
  _startRefreshTimer();
  _notifyListeners(getUser());
}

/**
 * Start the login flow. Opens the configured login page in the user's browser.
 */
function login() {
  _startAuthFlow(_config.loginDomain);
}

/**
 * Start the signup flow. Opens the configured signup page in the user's browser.
 */
function signup() {
  _startAuthFlow(_config.signupDomain);
}

function _startAuthFlow(domain) {
  const state = crypto.randomBytes(32).toString('hex');
  _pendingStates.set(state, { timestamp: Date.now(), used: false });
  _cleanupOldStates();

  if (!app.isPackaged) {
    // Dev mode: use a loopback HTTP server to receive the OAuth callback,
    // because setAsDefaultProtocolClient doesn't work reliably on macOS
    // when the app isn't packaged (custom protocol URLs fail to route back).
    _startLoopbackServer().then((redirectUri) => {
      const params = new URLSearchParams({ redirect_uri: redirectUri, state });
      shell.openExternal(`https://${domain}?${params.toString()}`);
    });
  } else {
    const params = new URLSearchParams({ redirect_uri: _config.redirectUri, state });
    shell.openExternal(`https://${domain}?${params.toString()}`);
  }
}

/**
 * Start a local HTTP server on 127.0.0.1 to receive the OAuth callback in dev mode.
 * Returns the redirect URI pointing to the loopback server.
 */
function _startLoopbackServer() {
  return new Promise((resolve, reject) => {
    _stopLoopbackServer(); // clean up any previous server

    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, `http://127.0.0.1`);
      if (reqUrl.pathname !== '/auth/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      // Send a response to the browser immediately
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>Authentication successful</h2><p>You can close this tab and return to the app.</p></body></html>');

      // Process the callback using the same handler as the deep link path
      const callbackUrl = `http://127.0.0.1${req.url}`;
      await handleCallback(callbackUrl);

      // Clean up the server
      _stopLoopbackServer();
    });

    server.listen(0, '127.0.0.1', () => {
      _loopbackServer = server;
      const port = server.address().port;
      resolve(`http://127.0.0.1:${port}/auth/callback`);
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

function _stopLoopbackServer() {
  if (_loopbackServer) {
    _loopbackServer.close();
    _loopbackServer = null;
  }
}

/**
 * Handle the OAuth2 callback deep link.
 * Called from main.js when toutkit://auth/callback is received.
 * @param {string} url - Full deep link URL
 */
async function handleCallback(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    _notifyListeners({ error: 'Invalid callback URL' });
    return;
  }

  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');
  const error = parsed.searchParams.get('error');

  // Handle error response (e.g., user cancelled)
  if (error) {
    _notifyListeners({ error: error });
    return;
  }

  if (!code || !state) {
    _notifyListeners({ error: 'Missing code or state in callback' });
    return;
  }

  // CSRF check
  if (!_validateState(state)) {
    _notifyListeners({ error: 'Invalid or expired state — possible CSRF attack' });
    return;
  }

  // Mark state as used
  const stateInfo = _pendingStates.get(state);
  if (stateInfo) stateInfo.used = true;

  try {
    const result = await _exchangeCodeForTokens(code);
    if (result.error) {
      _notifyListeners({ error: result.error });
      return;
    }

    _tokens = result;
    if (!_encryptionUnavailable) {
      authStore.saveTokens(_tokens);
    }

    _startRefreshTimer();
    _notifyListeners(getUser());
  } catch (err) {
    _notifyListeners({ error: 'Token exchange failed: ' + err.message });
  }
}

/**
 * Exchange authorization code for tokens via backend API.
 * Returns token object or { error } on failure.
 */
async function _exchangeCodeForTokens(code) {
  const apiUrl = new URL(_config.apiEndpoint + '/auth');

  const response = await _httpsPost(apiUrl.hostname, apiUrl.pathname, {
    action: 'code-exchange',
    code,
  }, 'application/json');

  if (response.status !== 200 || !response.body.success || !response.body.data || !response.body.data.idToken) {
    const errMsg = response.body.error || response.body.message || 'Code exchange failed';
    return { error: errMsg };
  }

  const data = response.body.data;
  const now = Date.now();

  return {
    accessToken: data.accessToken,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    accessTokenExpiresAt: now + ((data.expiresIn || 3600) * 1000),
    refreshTokenExpiresAt: now + (30 * 24 * 60 * 60 * 1000), // 30 days from now
  };
}

/**
 * Refresh the access token using the stored refresh token.
 * Returns true on success, false on failure (session expired).
 */
async function _refreshAccessToken() {
  if (!_tokens || !_tokens.refreshToken) return false;

  try {
    const response = await _httpsPost(_config.cognitoDomain, '/oauth2/token', {
      grant_type: 'refresh_token',
      refresh_token: _tokens.refreshToken,
      client_id: _config.clientId,
    });

    if (response.status !== 200 || !response.body.access_token) {
      // Refresh token expired or revoked — log out
      await _doLogout(false); // don't try to revoke (token is already invalid)
      return false;
    }

    const body = response.body;
    const now = Date.now();

    // Update access + id tokens; keep refresh token and its expiry
    _tokens = {
      ..._tokens,
      accessToken: body.access_token,
      idToken: body.id_token || _tokens.idToken,
      accessTokenExpiresAt: now + (body.expires_in * 1000),
    };

    if (!_encryptionUnavailable) {
      authStore.saveTokens(_tokens);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Log out the current user. Revokes refresh token, clears stored tokens.
 */
async function logout() {
  await _doLogout(true);
}

async function _doLogout(revokeToken) {
  _stopRefreshTimer();

  if (revokeToken && _tokens && _tokens.accessToken) {
    try {
      const apiUrl = new URL(_config.apiEndpoint + '/auth');
      await _httpsPost(apiUrl.hostname, apiUrl.pathname, {
        action: 'signout',
        accessToken: _tokens.accessToken,
      }, 'application/json');
    } catch {
      // Ignore revocation errors — clear locally regardless
    }
  }

  _tokens = null;
  authStore.clearTokens();
  _notifyListeners(null);
}

// ─── Token refresh timer ──────────────────────────────────────────────────────

function _startRefreshTimer() {
  _stopRefreshTimer();
  _refreshTimer = setInterval(async () => {
    if (!_tokens) return;
    // Refresh proactively 5 minutes before expiry
    const fiveMinutes = 5 * 60 * 1000;
    if (_tokens.accessTokenExpiresAt - Date.now() < fiveMinutes) {
      await _refreshAccessToken();
    }
  }, 60 * 1000); // check every 60 seconds
}

function _stopRefreshTimer() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}

// ─── Public getters ───────────────────────────────────────────────────────────

/**
 * Get current user info decoded from ID token.
 * Returns { sub, email, emailVerified } or null.
 */
function getUser() {
  if (!_tokens || !_tokens.idToken) return null;
  const payload = _decodeJwtPayload(_tokens.idToken);
  if (!payload) return null;
  return {
    sub: payload.sub,
    email: payload.email || null,
    emailVerified: payload.email_verified || false,
  };
}

/**
 * Returns true if a valid session exists (refresh token not expired).
 */
function isLoggedIn() {
  if (!_tokens) return false;
  if (_tokens.refreshTokenExpiresAt && _tokens.refreshTokenExpiresAt < Date.now()) return false;
  return true;
}

/**
 * Get current access token. Refreshes first if expired.
 * Returns token string or null. Used by future sync features.
 */
async function getAccessToken() {
  if (!_tokens) return null;
  if (_tokens.accessTokenExpiresAt < Date.now()) {
    const ok = await _refreshAccessToken();
    if (!ok) return null;
  }
  return _tokens.accessToken;
}

/**
 * Returns true if safeStorage encryption is unavailable on this platform.
 * Used to show a warning to the user that session won't persist.
 */
function isEncryptionUnavailable() {
  return _encryptionUnavailable;
}

module.exports = {
  init,
  login,
  signup,
  handleCallback,
  logout,
  getUser,
  isLoggedIn,
  getAccessToken,
  isEncryptionUnavailable,
  onAuthStateChanged,
};
