'use strict';

// note-files-sync.js — client-side noteFiles blob sync engine (feature 145)
//
// Timestamp convention (same as kv-sync.js):
//   - Locally, all timestamps are in MILLISECONDS (Date.now()).
//   - When pulling: server returns lastModified in SECONDS; converted to ms for LWW comparison.
//   - When pulling since: lastPullTimestamp is stored in SECONDS (server expects seconds).
//
// Local path:  <workspace>/<noteId>/storage/files/<name>
// S3 key:      note-data/{userId}/{noteId}/<name>  (no "storage/files/" in S3)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const syncApi = require('./sync-api');

const NOTES_APP_DIR = '.notes-app';
const FILES_QUEUE_FILE = 'files-sync-queue.json';
const FILES_STATE_FILE = 'files-sync-state.json';

const CONTENT_TYPES = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.pdf':  'application/pdf',
  '.json': 'application/json',
  '.txt':  'text/plain',
  '.csv':  'text/csv',
  '.zip':  'application/zip',
  '.mp3':  'audio/mpeg',
  '.mp4':  'video/mp4',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
  '.wasm': 'application/wasm',
  '.bin':  'application/octet-stream',
};

function _contentType(name) {
  const ext = path.extname(name).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

let _workspacePath = null;
// Queue: Array<{ noteId, name, action: "upload"|"delete", timestamp (ms) }>
let _queue = [];
// State: { lastPullTimestamp: number (seconds), fileHashes: { "<noteId>/<name>": { hash, size, syncedAt } } }
let _state = { lastPullTimestamp: 0, fileHashes: {} };
let _syncInProgress = false;

function _notesAppDir() {
  return path.join(_workspacePath, NOTES_APP_DIR);
}

function _queuePath() {
  return path.join(_notesAppDir(), FILES_QUEUE_FILE);
}

function _statePath() {
  return path.join(_notesAppDir(), FILES_STATE_FILE);
}

function _localFilePath(noteId, name) {
  return path.join(_workspacePath, noteId, 'storage', 'files', name);
}

function _hashFile(absPath) {
  try {
    const content = fs.readFileSync(absPath);
    return { hash: crypto.createHash('md5').update(content).digest('hex'), size: content.length, buffer: content };
  } catch {
    return null;
  }
}

function _loadState() {
  try {
    const raw = fs.readFileSync(_queuePath(), 'utf8');
    _queue = JSON.parse(raw);
    if (!Array.isArray(_queue)) _queue = [];
  } catch {
    _queue = [];
  }
  try {
    const raw = fs.readFileSync(_statePath(), 'utf8');
    const parsed = JSON.parse(raw);
    _state = {
      lastPullTimestamp: typeof parsed.lastPullTimestamp === 'number' ? parsed.lastPullTimestamp : 0,
      fileHashes: (parsed.fileHashes && typeof parsed.fileHashes === 'object') ? parsed.fileHashes : {},
    };
  } catch {
    _state = { lastPullTimestamp: 0, fileHashes: {} };
  }
}

function _saveQueue() {
  try {
    fs.mkdirSync(_notesAppDir(), { recursive: true });
    fs.writeFileSync(_queuePath(), JSON.stringify(_queue, null, 2), 'utf8');
  } catch {}
}

function _saveState() {
  try {
    fs.mkdirSync(_notesAppDir(), { recursive: true });
    fs.writeFileSync(_statePath(), JSON.stringify(_state, null, 2), 'utf8');
  } catch {}
}

/**
 * Initialize for a new workspace. Resets all in-memory state and loads from disk.
 * Must be called before enqueue/flush/pull/sync.
 */
function init(workspacePath) {
  _workspacePath = workspacePath;
  _queue = [];
  _state = { lastPullTimestamp: 0, fileHashes: {} };
  _syncInProgress = false;
  _loadState();
}

/**
 * Enqueue a file upload (called after note-files:save).
 * Deduplicates by (noteId, name): newer entry replaces older one.
 * An upload entry always wins over a pending delete for the same file.
 */
function enqueueUpload(noteId, name) {
  if (!_workspacePath) return;
  const entry = { noteId, name, action: 'upload', timestamp: Date.now() };
  const idx = _queue.findIndex(e => e.noteId === noteId && e.name === name);
  if (idx >= 0) {
    _queue[idx] = entry;
  } else {
    _queue.push(entry);
  }
  _saveQueue();
}

/**
 * Enqueue a file deletion (called after note-files:delete).
 * Deduplicates by (noteId, name).
 * A delete entry replaces any pending upload for the same file.
 */
function enqueueDelete(noteId, name) {
  if (!_workspacePath) return;
  const entry = { noteId, name, action: 'delete', timestamp: Date.now() };
  const idx = _queue.findIndex(e => e.noteId === noteId && e.name === name);
  if (idx >= 0) {
    _queue[idx] = entry;
  } else {
    _queue.push(entry);
  }
  _saveQueue();
}

/**
 * Push all queued uploads and deletes to S3 via the sync service.
 * Files that fail stay in queue for retry.
 * Returns { ok, uploaded, deleted, failed }.
 */
async function flush() {
  if (!_workspacePath) return { ok: false, uploaded: 0, deleted: 0, failed: 0 };
  if (_queue.length === 0) return { ok: true, uploaded: 0, deleted: 0, failed: 0 };

  const snapshot = [..._queue];
  const uploadEntries = snapshot.filter(e => e.action === 'upload');
  const deleteEntries = snapshot.filter(e => e.action === 'delete');

  const successfulKeys = new Set(); // "noteId\x00name\x00timestamp"
  let totalUploaded = 0;
  let totalDeleted = 0;
  let totalFailed = 0;

  // ── Process uploads in batches of 50 ────────────────────────────────────────
  const BATCH_SIZE = 50;
  for (let i = 0; i < uploadEntries.length; i += BATCH_SIZE) {
    const batch = uploadEntries.slice(i, i + BATCH_SIZE);
    const filesReq = batch.map(e => ({ noteId: e.noteId, name: e.name, contentType: _contentType(e.name) }));

    const presignResult = await syncApi.post('/notes/sync/files', { action: 'push', files: filesReq });
    if (!presignResult.ok) {
      totalFailed += batch.length;
      continue;
    }

    const presignedFiles = presignResult.data.files || [];

    for (let j = 0; j < batch.length; j++) {
      const entry = batch[j];
      const presigned = presignedFiles.find(f => f.noteId === entry.noteId && f.name === entry.name);
      if (!presigned) { totalFailed++; continue; }

      const absPath = _localFilePath(entry.noteId, entry.name);
      const fileInfo = _hashFile(absPath);
      if (!fileInfo) { totalFailed++; continue; } // file was deleted between enqueue and flush

      const uploadResult = await syncApi.uploadToPresignedUrl(presigned.presignedPutUrl, fileInfo.buffer, _contentType(entry.name));
      if (uploadResult.ok) {
        const key = `${entry.noteId}/${entry.name}`;
        _state.fileHashes[key] = { hash: fileInfo.hash, size: fileInfo.size, syncedAt: Math.floor(Date.now() / 1000) };
        successfulKeys.add(`${entry.noteId}\x00${entry.name}\x00${entry.timestamp}`);
        totalUploaded++;
      } else {
        totalFailed++;
      }
    }
  }

  // ── Process deletes in a single request ──────────────────────────────────────
  if (deleteEntries.length > 0) {
    const filesReq = deleteEntries.map(e => ({ noteId: e.noteId, name: e.name }));
    const deleteResult = await syncApi.post('/notes/sync/files', { action: 'delete', files: filesReq });
    if (deleteResult.ok) {
      for (const entry of deleteEntries) {
        const key = `${entry.noteId}/${entry.name}`;
        delete _state.fileHashes[key];
        successfulKeys.add(`${entry.noteId}\x00${entry.name}\x00${entry.timestamp}`);
        totalDeleted++;
      }
    } else {
      totalFailed += deleteEntries.length;
    }
  }

  // Remove successfully processed entries; keep new arrivals and failed items
  _queue = _queue.filter(e => !successfulKeys.has(`${e.noteId}\x00${e.name}\x00${e.timestamp}`));
  _saveQueue();
  _saveState();

  return { ok: totalFailed === 0, uploaded: totalUploaded, deleted: totalDeleted, failed: totalFailed };
}

/**
 * Pull remote file changes since lastPullTimestamp and write them to disk.
 * Conflict resolution: last-write-wins by timestamp (local mtime vs remote lastModified).
 * Returns { ok, downloaded, skipped, conflicts }.
 */
async function pull() {
  if (!_workspacePath) return { ok: false, downloaded: 0, skipped: 0, conflicts: 0 };

  // Server expects seconds
  const result = await syncApi.post('/notes/sync/files', { action: 'pull', since: _state.lastPullTimestamp });
  if (!result.ok) return { ok: false, downloaded: 0, skipped: 0, conflicts: 0 };

  const files = result.data.files || [];
  let downloaded = 0;
  let skipped = 0;
  let conflicts = 0;
  let maxLastModified = _state.lastPullTimestamp;

  for (const { noteId, name, presignedGetUrl, lastModified, etag } of files) {
    const key = `${noteId}/${name}`;
    const remoteHash = etag; // S3 ETag == MD5 for single-part uploads

    // Skip if remote hash matches our tracked synced hash (already have this version)
    const tracked = _state.fileHashes[key];
    if (tracked && tracked.hash === remoteHash) {
      skipped++;
      if (lastModified > maxLastModified) maxLastModified = lastModified;
      continue;
    }

    const absPath = _localFilePath(noteId, name);
    const localExists = fs.existsSync(absPath);

    // Conflict detection: local file exists AND its current hash differs from both
    // the synced hash and the remote hash → both sides changed since last sync → LWW
    if (localExists && tracked) {
      let localCurrentHash;
      try {
        const localBuf = fs.readFileSync(absPath);
        localCurrentHash = crypto.createHash('md5').update(localBuf).digest('hex');
      } catch {
        localCurrentHash = null;
      }
      if (localCurrentHash && localCurrentHash !== tracked.hash && localCurrentHash !== remoteHash) {
        // Real conflict: compare mtimes
        let localMtimeSec;
        try { localMtimeSec = Math.floor(fs.statSync(absPath).mtimeMs / 1000); } catch { localMtimeSec = 0; }
        if (localMtimeSec >= lastModified) {
          // Local is newer → skip remote (local will be pushed next flush if in queue, or enqueued by fullScan)
          conflicts++;
          skipped++;
          if (lastModified > maxLastModified) maxLastModified = lastModified;
          continue;
        }
        conflicts++;
        // Remote is newer → fall through to download
      }
    }

    // Download from S3
    const dlResult = await syncApi.downloadFromPresignedUrl(presignedGetUrl);
    if (!dlResult.ok) {
      skipped++;
      continue;
    }

    // Atomic write via .tmp rename
    try {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      const tmpPath = absPath + '.tmp';
      try {
        fs.writeFileSync(tmpPath, dlResult.buffer);
        fs.renameSync(tmpPath, absPath);
      } finally {
        try { fs.unlinkSync(tmpPath); } catch {}
      }
      const hash = crypto.createHash('md5').update(dlResult.buffer).digest('hex');
      _state.fileHashes[key] = { hash, size: dlResult.buffer.length, syncedAt: Math.floor(Date.now() / 1000) };
      downloaded++;
    } catch (err) {
      console.error('[note-files-sync] Failed to write downloaded file:', key, err.message);
      skipped++;
    }

    if (lastModified > maxLastModified) maxLastModified = lastModified;
  }

  if (maxLastModified > _state.lastPullTimestamp) {
    _state.lastPullTimestamp = maxLastModified;
  } else if (files.length === 0) {
    // No files returned — advance timestamp to now to avoid re-scanning everything next pull
    _state.lastPullTimestamp = Math.floor(Date.now() / 1000);
  }

  _saveState();
  return { ok: true, downloaded, skipped, conflicts };
}

/**
 * Full sync cycle: flush pending changes, then pull remote changes.
 * Guards against concurrent runs.
 * Returns { ok, flush, pull } or { ok: false, reason: 'already-in-progress' }.
 */
async function sync() {
  if (_syncInProgress) return { ok: false, reason: 'already-in-progress' };
  _syncInProgress = true;
  try {
    const flushResult = await flush();
    const pullResult = await pull();
    return { ok: flushResult.ok && pullResult.ok, flush: flushResult, pull: pullResult };
  } finally {
    _syncInProgress = false;
  }
}

/**
 * Walk all <noteId>/storage/files/ directories in the workspace.
 * For each file, if its hash differs from tracked state (or it is untracked), enqueue for upload.
 * This is the initial catch-up mechanism — runs once on workspace open.
 * Does NOT make network calls; just populates the upload queue.
 */
function fullScan() {
  if (!_workspacePath) return;

  let entries;
  try { entries = fs.readdirSync(_workspacePath, { withFileTypes: true }); } catch { return; }

  for (const noteDir of entries) {
    if (!noteDir.isDirectory()) continue;
    if (noteDir.name.startsWith('.')) continue;

    const filesDir = path.join(_workspacePath, noteDir.name, 'storage', 'files');
    let files;
    try { files = fs.readdirSync(filesDir, { withFileTypes: true }); } catch { continue; }

    for (const f of files) {
      if (!f.isFile()) continue;
      if (f.name.startsWith('.')) continue;

      const name = f.name;
      const noteId = noteDir.name;
      const key = `${noteId}/${name}`;
      const absPath = path.join(filesDir, name);

      const tracked = _state.fileHashes[key];
      const fileInfo = _hashFile(absPath);
      if (!fileInfo) continue;

      if (!tracked || tracked.hash !== fileInfo.hash) {
        // File is new or changed since last sync — enqueue for upload
        enqueueUpload(noteId, name);
      }
    }
  }
}

/**
 * Returns current sync status.
 */
function getStatus() {
  return {
    lastPullTimestamp: _state.lastPullTimestamp,
    queueLength: _queue.length,
    syncInProgress: _syncInProgress,
    trackedFileCount: Object.keys(_state.fileHashes).length,
  };
}

/**
 * Clear all in-memory and persisted state (call on logout or workspace switch).
 */
function clearState() {
  _queue = [];
  _state = { lastPullTimestamp: 0, fileHashes: {} };
  _syncInProgress = false;
  try { fs.unlinkSync(_queuePath()); } catch {}
  try { fs.unlinkSync(_statePath()); } catch {}
}

module.exports = { init, enqueueUpload, enqueueDelete, flush, pull, sync, fullScan, getStatus, clearState };
