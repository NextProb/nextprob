'use strict';
const fs = require('fs');
const { fetchJSON } = require('./remote-models');

const { templatesManifestUrl: MANIFEST_URL } = require('../main/content-urls');

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let _cachedManifest = null;
let _lastManifestFetch = 0;

/**
 * Fetch the remote manifest (template id → { version }).
 * Returns an object like { "meeting-notes": { version: 2 }, ... } or null on failure.
 * Cached for 1 hour.
 */
async function getRemoteManifest() {
  const now = Date.now();
  if (_cachedManifest && (now - _lastManifestFetch) < CACHE_TTL_MS) return _cachedManifest;

  const data = await fetchJSON(MANIFEST_URL);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    _cachedManifest = data;
    _lastManifestFetch = now;
  }
  return _cachedManifest; // null on first failure
}

/** Backward-compatible template-only entry point for template restoration. */
async function downloadTemplateFolders() {
  const result = await require('./remote-content').downloadContentFolders();
  if (result && !result.templatesDir) {
    fs.rmSync(result.tmpDir, { recursive: true, force: true });
    return null;
  }
  return result;
}

module.exports = { getRemoteManifest, downloadTemplateFolders };
