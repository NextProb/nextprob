'use strict';

// kv-sync.js — client-side KV sync engine (feature 144)
//
// Timestamp convention:
//   - Locally, all timestamps are in MILLISECONDS (Date.now()).
//   - The server stores `updatedAt` in SECONDS (Math.floor(Date.now()/1000)).
//   - When pushing: client sends ms timestamps; server converts to seconds.
//   - When pulling: server returns updatedAt in seconds; pull() converts to ms for LWW comparison.

const fs = require('fs');
const path = require('path');
const syncApi = require('./sync-api');
const noteDb = require('./note-db');

const NOTES_APP_DIR = '.notes-app';
const KV_QUEUE_FILE = 'kv-sync-queue.json';
const KV_STATE_FILE = 'kv-sync-state.json';

let _workspacePath = null;
let _queue = [];            // Array<{ noteId, key, value, deleted, timestamp (ms) }>
let _lastSyncTimestamp = 0; // ms; stored in state file
let _syncInProgress = false;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _notesAppDir() {
  return path.join(_workspacePath, NOTES_APP_DIR);
}

function _queuePath() {
  return path.join(_notesAppDir(), KV_QUEUE_FILE);
}

function _statePath() {
  return path.join(_notesAppDir(), KV_STATE_FILE);
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
    const state = JSON.parse(raw);
    _lastSyncTimestamp = typeof state.lastSyncTimestamp === 'number' ? state.lastSyncTimestamp : 0;
  } catch {
    _lastSyncTimestamp = 0;
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
    fs.writeFileSync(_statePath(), JSON.stringify({ lastSyncTimestamp: _lastSyncTimestamp }, null, 2), 'utf8');
  } catch {}
}

// ─── Exported functions ───────────────────────────────────────────────────────

/**
 * Initialize for a new workspace. Resets all in-memory state and loads from disk.
 * Must be called before enqueue/flush/pull/sync.
 */
function init(workspacePath) {
  _workspacePath = workspacePath;
  _queue = [];
  _lastSyncTimestamp = 0;
  _syncInProgress = false;
  _loadState();
}

/**
 * Enqueue a KV write or delete for the next flush.
 * Deduplicates by (noteId, key): newer entry replaces older one.
 */
function enqueue(noteId, key, value, deleted) {
  const entry = {
    noteId,
    key,
    value: deleted ? null : value,
    deleted: !!deleted,
    timestamp: Date.now(),
  };
  const idx = _queue.findIndex(e => e.noteId === noteId && e.key === key);
  if (idx >= 0) {
    _queue[idx] = entry;
  } else {
    _queue.push(entry);
  }
  _saveQueue();
}

/**
 * Push pending queue to the server in batches of 25.
 * Items that fail stay in the queue for the next flush.
 * Returns { ok, pushed, failed }.
 */
async function flush() {
  if (_queue.length === 0) return { ok: true, pushed: 0, failed: 0 };
  if (!_workspacePath) return { ok: false, pushed: 0, failed: 0 };

  // Snapshot to avoid races with concurrent enqueue() calls
  const snapshot = [..._queue];
  const BATCH_SIZE = 25;
  const successfulItems = []; // items from snapshot that were flushed successfully
  let totalPushed = 0;
  let totalFailed = 0;

  for (let i = 0; i < snapshot.length; i += BATCH_SIZE) {
    const batch = snapshot.slice(i, i + BATCH_SIZE);
    const result = await syncApi.post('/notes/sync/kv', { action: 'push', changes: batch });
    if (result.ok) {
      totalPushed += result.data?.pushed ?? batch.length;
      successfulItems.push(...batch);
    } else {
      totalFailed += batch.length;
    }
  }

  // Build a set of successfully flushed (noteId, key, timestamp) triples
  const flushedKeys = new Set(successfulItems.map(e => `${e.noteId}\x00${e.key}\x00${e.timestamp}`));

  // Remove flushed items; keep new arrivals (not in snapshot) and failed items
  _queue = _queue.filter(e => !flushedKeys.has(`${e.noteId}\x00${e.key}\x00${e.timestamp}`));
  _saveQueue();

  return { ok: totalFailed === 0, pushed: totalPushed, failed: totalFailed };
}

/**
 * Pull remote changes since _lastSyncTimestamp and apply them to local kv.json files.
 * LWW: if the local queue has a pending write for the same (noteId, key) that is newer,
 * the remote value is skipped — it will be overwritten on next flush.
 * Returns { ok, applied, skipped }.
 */
async function pull() {
  if (!_workspacePath) return { ok: false, applied: 0, skipped: 0 };

  // Server uses seconds for updatedAt
  const since = Math.floor(_lastSyncTimestamp / 1000);
  const result = await syncApi.post('/notes/sync/kv', { action: 'pull', since });
  if (!result.ok) return { ok: false, applied: 0, skipped: 0 };

  const changes = result.data?.changes || [];
  let applied = 0;
  let skipped = 0;
  let maxUpdatedAt = _lastSyncTimestamp; // ms

  for (const change of changes) {
    const { noteId, key, value, deleted, updatedAt } = change;
    // Convert server seconds → ms for local LWW comparison
    const remoteTs = updatedAt * 1000;

    // LWW: skip if we have a pending local write that is newer
    const localEntry = _queue.find(e => e.noteId === noteId && e.key === key);
    if (localEntry && localEntry.timestamp >= remoteTs) {
      skipped++;
      continue;
    }

    // Apply to local KV store
    try {
      const data = noteDb.noteDbLoad(_workspacePath, noteId);
      if (deleted) {
        delete data[key];
      } else {
        data[key] = value;
      }
      noteDb.noteDbFlush(_workspacePath, noteId, data);
      applied++;
    } catch {
      skipped++;
    }

    if (remoteTs > maxUpdatedAt) maxUpdatedAt = remoteTs;
  }

  if (maxUpdatedAt > _lastSyncTimestamp) {
    _lastSyncTimestamp = maxUpdatedAt;
    _saveState();
  }

  return { ok: true, applied, skipped };
}

/**
 * Full sync cycle: flush pending writes, then pull remote changes.
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
 * Returns current sync status (queue length, last sync timestamp, in-progress flag).
 */
function getStatus() {
  return {
    lastSyncTimestamp: _lastSyncTimestamp,
    queueLength: _queue.length,
    syncInProgress: _syncInProgress,
  };
}

/**
 * Clear all in-memory and persisted state (call on logout or workspace switch).
 */
function clearState() {
  _queue = [];
  _lastSyncTimestamp = 0;
  _syncInProgress = false;
  try { fs.unlinkSync(_queuePath()); } catch {}
  try { fs.unlinkSync(_statePath()); } catch {}
}

module.exports = { init, enqueue, flush, pull, sync, getStatus, clearState };
