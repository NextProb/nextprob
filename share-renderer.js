'use strict';

// Manages the gist-share renderer (index.html + robots.txt) that gets pushed
// into each user's `<repo>/` on first publish. Source of truth lives in the
// content repo (hs-update-model-list/share-renderer/); bundled copies in this
// repo are the offline fallback.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { fetchText } = require('./providers/remote-models');
const { shareRendererUrl, shareRobotsUrl } = require('./content-urls');

const BUNDLED_DIR = path.join(__dirname, 'share-renderer');
const cacheDir = () => path.join(app.getPath('userData'), 'share-renderer');

let _current = null; // { indexHtml, robotsTxt, indexSha }

// Match GitHub's content sha (git blob sha-1) so callers can compare directly
// against the `sha` field returned by the Contents API.
function _gitBlobSha(content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const header = Buffer.from(`blob ${buf.length}\0`);
  return crypto.createHash('sha1').update(Buffer.concat([header, buf])).digest('hex');
}

function _build({ indexHtml, robotsTxt }) {
  return { indexHtml, robotsTxt, indexSha: _gitBlobSha(indexHtml) };
}

function _readBundled() {
  const indexHtml = fs.readFileSync(path.join(BUNDLED_DIR, 'index.html'), 'utf8');
  const robotsTxt = fs.readFileSync(path.join(BUNDLED_DIR, 'robots.txt'), 'utf8');
  return _build({ indexHtml, robotsTxt });
}

function _readCached() {
  try {
    const dir = cacheDir();
    const indexHtml = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const robotsTxt = fs.readFileSync(path.join(dir, 'robots.txt'), 'utf8');
    return _build({ indexHtml, robotsTxt });
  } catch {
    return null;
  }
}

function _writeCached({ indexHtml, robotsTxt }) {
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), indexHtml, 'utf8');
  fs.writeFileSync(path.join(dir, 'robots.txt'), robotsTxt, 'utf8');
}

/**
 * Pull the latest renderer from the content repo. Silently no-ops on
 * network failure so callers keep whatever copy they already have.
 */
async function refresh() {
  try {
    const [indexHtml, robotsTxt] = await Promise.all([
      fetchText(shareRendererUrl),
      fetchText(shareRobotsUrl),
    ]);
    if (typeof indexHtml === 'string' && indexHtml.trim()
        && typeof robotsTxt === 'string' && robotsTxt.trim()) {
      _writeCached({ indexHtml, robotsTxt });
      _current = _build({ indexHtml, robotsTxt });
    }
  } catch {
    // ignore — bundled/cached copy is still valid
  }
}

function init() {
  _current = _readCached() || _readBundled();
  refresh();
}

/**
 * Returns { indexHtml, robotsTxt, indexSha }. Prefers cached → bundled.
 * Phase 3 will compare indexSha against the user's repo to decide whether
 * to push an update.
 */
function getRenderer() {
  if (!_current) _current = _readCached() || _readBundled();
  return _current;
}

module.exports = { init, refresh, getRenderer };
