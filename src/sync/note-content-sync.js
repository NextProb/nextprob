'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const syncApi = require('./sync-api');
const syncIgnore = require('./sync-ignore');

let _workspacePath = null;
let _syncState = { lastSyncTimestamp: 0, fileHashes: {} };
let _syncInProgress = false;

const NOTES_APP_DIR = '.notes-app';
const SYNC_STATE_FILE = 'sync-state.json';

// ─── Init ─────────────────────────────────────────────────────────────────────

function init(workspacePath) {
  _workspacePath = workspacePath;
  _syncState = { lastSyncTimestamp: 0, fileHashes: {} };
  _loadSyncState();
}

function _notesAppDir() {
  return path.join(_workspacePath, NOTES_APP_DIR);
}

function _syncStatePath() {
  return path.join(_notesAppDir(), SYNC_STATE_FILE);
}

function _loadSyncState() {
  try {
    const raw = fs.readFileSync(_syncStatePath(), 'utf8');
    _syncState = JSON.parse(raw);
  } catch {
    _syncState = { lastSyncTimestamp: 0, fileHashes: {} };
  }
}

function _saveSyncState() {
  try {
    fs.mkdirSync(_notesAppDir(), { recursive: true });
    fs.writeFileSync(_syncStatePath(), JSON.stringify(_syncState, null, 2), 'utf8');
  } catch (err) {
    console.error('[note-content-sync] Failed to save sync state:', err.message);
  }
}

// ─── Hash computation ─────────────────────────────────────────────────────────

/**
 * Walk the workspace and compute MD5 hash of every file not excluded by .syncignore.
 * Returns { "relativePath": "md5hex", ... }.
 * MD5 matches S3 ETag format for single-part uploads.
 */
function computeFileHashes() {
  const ig = syncIgnore.loadIgnore(_workspacePath);
  const hashes = {};
  _walkDir(_workspacePath, _workspacePath, hashes, ig);
  return hashes;
}

function _walkDir(baseDir, currentDir, hashes, ig) {
  let entries;
  try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const abs = path.join(currentDir, entry.name);
    const rel = path.relative(baseDir, abs).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (ig.ignores(rel + '/')) continue;
      _walkDir(baseDir, abs, hashes, ig);
    } else if (entry.isFile()) {
      if (ig.ignores(rel)) continue;
      try {
        const content = fs.readFileSync(abs);
        hashes[rel] = crypto.createHash('md5').update(content).digest('hex');
      } catch { /* skip unreadable files */ }
    }
  }
}

function _hashFile(absPath) {
  try {
    const content = fs.readFileSync(absPath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch {
    return null;
  }
}

// ─── Sync cycle ───────────────────────────────────────────────────────────────

/**
 * Execute one full sync cycle (push + pull).
 * Returns { uploaded, downloaded, conflicts } or { ok: false, error }.
 */
async function syncContent() {
  if (!_workspacePath) return { ok: false, error: 'no-workspace' };
  if (_syncInProgress) return { ok: false, error: 'sync-in-progress' };
  _syncInProgress = true;
  try {
    return await _doSyncContent();
  } finally {
    _syncInProgress = false;
  }
}

async function _doSyncContent() {
  const ig = syncIgnore.loadIgnore(_workspacePath);
  const localHashes = computeFileHashes();

  // Files that were previously synced but are now excluded by syncignore
  // must be explicitly deleted from the server
  const prevHashes = _syncState.fileHashes || {};
  const deletedPaths = Object.keys(prevHashes).filter(p => ig.ignores(p) && !(p in localHashes));

  const result = await syncApi.post('/notes/sync/content', {
    hashes: localHashes,
    deletedPaths,
  });

  if (!result.ok) return result;

  const { toUpload = [], toDownload = [], conflicts = [] } = result.data;

  let uploaded = 0;
  let downloaded = 0;
  const resolvedConflicts = [];

  // Upload: files that exist locally but not on server
  for (const { path: relPath, presignedPutUrl } of toUpload) {
    const absPath = path.join(_workspacePath, relPath);
    let buffer;
    try { buffer = fs.readFileSync(absPath); } catch { continue; }
    const uploadResult = await syncApi.uploadToPresignedUrl(presignedPutUrl, buffer, syncIgnore.contentType(relPath));
    if (uploadResult.ok) {
      uploaded++;
    } else if (uploadResult.statusCode === 403) {
      // Presigned URL expired — retry with a fresh sync request
      const retryResult = await _retryUpload(relPath, localHashes[relPath]);
      if (retryResult) uploaded++;
    }
  }

  // Download: files on server that client doesn't have
  for (const { path: relPath, presignedGetUrl } of toDownload) {
    const dlResult = await syncApi.downloadFromPresignedUrl(presignedGetUrl);
    if (!dlResult.ok) continue;
    const absPath = path.join(_workspacePath, relPath);
    try {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, dlResult.buffer);
      downloaded++;
    } catch (err) {
      console.error('[note-content-sync] Failed to write downloaded file:', relPath, err.message);
    }
  }

  // Conflicts: server ETag differs from client hash. Use lastSyncedHash to
  // classify each one and only create a conflict file for a genuine divergence.
  for (const relPath of conflicts) {
    const lastSyncedHash = _syncState.fileHashes[relPath];
    const currentLocalHash = localHashes[relPath];

    if (lastSyncedHash && currentLocalHash === lastSyncedHash) {
      // Local unchanged since last sync → server is newer → download
      const freshResult = await syncApi.post('/notes/sync/content', { forceDownloadPaths: [relPath] });
      if (freshResult.ok && freshResult.data.toDownload?.length > 0) {
        const { presignedGetUrl } = freshResult.data.toDownload[0];
        const dlResult = await syncApi.downloadFromPresignedUrl(presignedGetUrl);
        if (dlResult.ok) {
          const absPath = path.join(_workspacePath, relPath);
          fs.writeFileSync(absPath, dlResult.buffer);
          downloaded++;
          continue;
        }
      }
    } else if (lastSyncedHash) {
      // Local changed since last sync → local is newer → force upload
      const forceResult = await syncApi.post('/notes/sync/content', { forceUploadPaths: [relPath] });
      if (forceResult.ok && forceResult.data.toUpload?.length > 0) {
        const { presignedPutUrl } = forceResult.data.toUpload[0];
        const absPath = path.join(_workspacePath, relPath);
        let buffer;
        try { buffer = fs.readFileSync(absPath); } catch { continue; }
        const uploadResult = await syncApi.uploadToPresignedUrl(presignedPutUrl, buffer, syncIgnore.contentType(relPath));
        if (uploadResult.ok) {
          uploaded++;
          continue;
        }
      }
    }

    // Genuine divergence (no lastSyncedHash → never synced before, or force-upload failed).
    // Download server version as .conflict.{timestamp}.html for manual resolution.
    const conflictPath = _conflictFilePath(relPath);
    const targetResult = await syncApi.post('/notes/sync/content', { forceDownloadPaths: [relPath] });
    if (targetResult.ok && targetResult.data.toDownload?.length > 0) {
      const { presignedGetUrl } = targetResult.data.toDownload[0];
      const dlResult = await syncApi.downloadFromPresignedUrl(presignedGetUrl);
      if (dlResult.ok) {
        const conflictAbsPath = path.join(_workspacePath, conflictPath);
        fs.mkdirSync(path.dirname(conflictAbsPath), { recursive: true });
        fs.writeFileSync(conflictAbsPath, dlResult.buffer);
        resolvedConflicts.push({ local: relPath, conflict: conflictPath });
      }
    }
  }

  // Update sync state with current local hashes (after downloads may have changed some)
  const updatedHashes = computeFileHashes();
  _syncState = { lastSyncTimestamp: Date.now(), fileHashes: updatedHashes };
  _saveSyncState();

  return { ok: true, uploaded, downloaded, conflicts: resolvedConflicts };
}

function _conflictFilePath(relPath) {
  const ts = Date.now();
  const ext = path.extname(relPath);
  const base = relPath.slice(0, relPath.length - ext.length);
  return `${base}.conflict.${ts}${ext}`;
}

async function _retryUpload(relPath, _localHash) {
  const retryResult = await syncApi.post('/notes/sync/content', { forceUploadPaths: [relPath] });
  if (!retryResult.ok || !retryResult.data.toUpload?.length) return false;
  const { presignedPutUrl } = retryResult.data.toUpload[0];
  const absPath = path.join(_workspacePath, relPath);
  let buffer;
  try { buffer = fs.readFileSync(absPath); } catch { return false; }
  const uploadResult = await syncApi.uploadToPresignedUrl(presignedPutUrl, buffer, syncIgnore.contentType(relPath));
  return uploadResult.ok;
}

// ─── Single-file push (debounced save trigger) ────────────────────────────────

/**
 * Push a single file after save. Used by the per-file debounced trigger.
 * Returns { ok, uploaded, conflict } or { ok: false, error }.
 */
async function pushFile(relativePath) {
  if (!_workspacePath) return { ok: false, error: 'no-workspace' };
  if (_syncInProgress) return { ok: true, uploaded: 0 };

  const absPath = path.join(_workspacePath, relativePath);
  const hash = _hashFile(absPath);
  if (!hash) return { ok: false, error: 'file-not-readable' };

  const result = await syncApi.post('/notes/sync/content', {
    hashes: { [relativePath]: hash },
    deletedPaths: [],
  });

  if (!result.ok) return result;

  const { toUpload = [], conflicts = [] } = result.data;

  if (toUpload.length > 0) {
    let buffer;
    try { buffer = fs.readFileSync(absPath); } catch { return { ok: false, error: 'file-not-readable' }; }
    const uploadResult = await syncApi.uploadToPresignedUrl(toUpload[0].presignedPutUrl, buffer, syncIgnore.contentType(relativePath));
    if (uploadResult.ok) {
      _syncState.fileHashes[relativePath] = hash;
      _syncState.lastSyncTimestamp = Date.now();
      _saveSyncState();
      return { ok: true, uploaded: 1 };
    }
    if (uploadResult.statusCode === 403) {
      const retried = await _retryUpload(relativePath, hash);
      if (retried) {
        _syncState.fileHashes[relativePath] = hash;
        _saveSyncState();
        return { ok: true, uploaded: 1 };
      }
    }
    return { ok: false, error: uploadResult.error };
  }

  if (conflicts.length > 0) {
    const lastSyncedHash = _syncState.fileHashes[relativePath];

    if (lastSyncedHash && hash === lastSyncedHash) {
      // Local unchanged since last sync — server is newer, auto-download
      const freshResult = await syncApi.post('/notes/sync/content', { forceDownloadPaths: [relativePath] });
      if (freshResult.ok && freshResult.data.toDownload?.length > 0) {
        const dlResult = await syncApi.downloadFromPresignedUrl(freshResult.data.toDownload[0].presignedGetUrl);
        if (dlResult.ok) {
          fs.writeFileSync(absPath, dlResult.buffer);
          _syncState.fileHashes[relativePath] = _hashFile(absPath);
          _saveSyncState();
          return { ok: true, uploaded: 0 };
        }
      }
    } else if (lastSyncedHash) {
      // Local changed since last sync — local is newer, force upload
      const forceResult = await syncApi.post('/notes/sync/content', { forceUploadPaths: [relativePath] });
      if (forceResult.ok && forceResult.data.toUpload?.length > 0) {
        let buffer;
        try { buffer = fs.readFileSync(absPath); } catch { return { ok: false, error: 'file-not-readable' }; }
        const uploadResult = await syncApi.uploadToPresignedUrl(forceResult.data.toUpload[0].presignedPutUrl, buffer, syncIgnore.contentType(relativePath));
        if (uploadResult.ok) {
          _syncState.fileHashes[relativePath] = hash;
          _syncState.lastSyncTimestamp = Date.now();
          _saveSyncState();
          return { ok: true, uploaded: 1 };
        }
      }
      // Force upload failed — fall through to conflict handling
    }

    // Genuine first-time collision (no lastSyncedHash) or force-upload failed —
    // download server version as conflict file for manual resolution
    const conflictPath = _conflictFilePath(relativePath);
    const dlReq = await syncApi.post('/notes/sync/content', { forceDownloadPaths: [relativePath] });
    if (dlReq.ok && dlReq.data.toDownload?.length > 0) {
      const dlResult = await syncApi.downloadFromPresignedUrl(dlReq.data.toDownload[0].presignedGetUrl);
      if (dlResult.ok) {
        const conflictAbsPath = path.join(_workspacePath, conflictPath);
        fs.writeFileSync(conflictAbsPath, dlResult.buffer);
        return { ok: true, conflict: { local: relativePath, conflict: conflictPath } };
      }
    }
    return { ok: false, error: 'conflict-download-failed' };
  }

  // Nothing to do (file is already in sync)
  return { ok: true, uploaded: 0 };
}

// ─── Deletion ─────────────────────────────────────────────────────────────────

/**
 * Notify server of a locally deleted file.
 * Server will delete the S3 object.
 */
async function handleDeletion(relativePath) {
  if (!_workspacePath) return;
  delete _syncState.fileHashes[relativePath];
  _saveSyncState();

  await syncApi.post('/notes/sync/content', {
    hashes: {},
    deletedPaths: [relativePath],
  });
}

// ─── Status ───────────────────────────────────────────────────────────────────

function getSyncState() {
  return {
    lastSyncTimestamp: _syncState.lastSyncTimestamp,
    fileCount: Object.keys(_syncState.fileHashes).length,
    syncInProgress: _syncInProgress,
  };
}

function clearSyncState() {
  _syncState = { lastSyncTimestamp: 0, fileHashes: {} };
  _saveSyncState();
}

module.exports = {
  init,
  computeFileHashes,
  syncContent,
  pushFile,
  handleDeletion,
  getSyncState,
  clearSyncState,
};
