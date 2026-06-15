'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { fetchJSON } = require('./remote-models');

const {
  templatesManifestUrl: MANIFEST_URL,
  templatesTarballUrl: TARBALL_URL,
} = require('../content-urls');

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

/**
 * Download the repo tarball, extract the templates/ subtree, and return
 * the path to the extracted templates directory (a temp folder).
 * Caller is responsible for cleaning up the returned tmpDir.
 * Returns { tmpDir, templatesDir } or null on failure.
 */
async function downloadTemplateFolders() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hn-templates-'));
  try {
    const tarballPath = path.join(tmpDir, 'repo.tar.gz');

    // Download tarball
    const https = require('https');
    await new Promise((resolve, reject) => {
      const download = (url, redirectCount = 0) => {
        if (redirectCount > 5) return reject(new Error('Too many redirects'));
        const mod = url.startsWith('https') ? https : require('http');
        mod.get(url, { headers: { 'User-Agent': 'notes-app' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return download(res.headers.location, redirectCount + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          const ws = fs.createWriteStream(tarballPath);
          res.pipe(ws);
          ws.on('finish', resolve);
          ws.on('error', reject);
        }).on('error', reject);
      };
      download(TARBALL_URL);
    });

    // Extract tarball
    execFileSync('tar', ['xzf', tarballPath, '-C', tmpDir]);

    // Find the extracted root directory (GitHub tarballs have a dynamic prefix)
    const entries = fs.readdirSync(tmpDir).filter(e =>
      e !== 'repo.tar.gz' && fs.statSync(path.join(tmpDir, e)).isDirectory()
    );
    if (entries.length === 0) {
      throw new Error('No directory found in tarball');
    }
    const repoRoot = path.join(tmpDir, entries[0]);
    const templatesDir = path.join(repoRoot, 'templates');
    if (!fs.existsSync(templatesDir) || !fs.statSync(templatesDir).isDirectory()) {
      throw new Error('templates/ directory not found in tarball');
    }

    // Component templates (optional — may not exist yet in older repo versions)
    const componentTemplatesDir = path.join(repoRoot, 'component-templates');
    const hasComponentTemplates = fs.existsSync(componentTemplatesDir)
      && fs.statSync(componentTemplatesDir).isDirectory();

    return { tmpDir, templatesDir, componentTemplatesDir: hasComponentTemplates ? componentTemplatesDir : null };
  } catch (err) {
    // Clean up on failure
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    console.warn('[remote-templates] tarball download failed:', err.message);
    return null;
  }
}

module.exports = { getRemoteManifest, downloadTemplateFolders };
