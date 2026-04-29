'use strict';
const https = require('https');
const http = require('http');
const { modelsJsonUrl: MODELS_URL } = require('../content-urls');

const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetches a URL and returns the raw body as a string, or null on failure.
 * Follows one redirect. Used by fetchJSON and fetchText.
 */
function fetchRaw(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      // Follow one redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return fetchRaw(res.headers.location).then(resolve);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Fetches JSON from a URL. Returns parsed object or null on failure.
 */
function fetchJSON(url) {
  return fetchRaw(url).then((raw) => {
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return null; }
  });
}

/**
 * Fetches text from a URL. Returns string or null on failure.
 */
function fetchText(url) {
  return fetchRaw(url);
}

let _cached = null;
let _lastFetch = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Returns remote model definitions, or null if unavailable.
 * Shape: { "claude-cli": [ { id, label } ], "gemini-cli": [...], ... }
 * Results are cached for 1 hour.
 */
async function getRemoteModels() {
  const now = Date.now();
  if (_cached && (now - _lastFetch) < CACHE_TTL_MS) return _cached;

  const data = await fetchJSON(MODELS_URL);
  if (data && typeof data === 'object') {
    _cached = data;
    _lastFetch = now;
  }
  return _cached; // may still be null on first failure
}

module.exports = { getRemoteModels, fetchJSON, fetchText };
