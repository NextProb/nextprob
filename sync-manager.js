'use strict';
const EventEmitter = require('events');
const { net } = require('electron');
const auth = require('./auth');
const noteContentSync = require('./note-content-sync');
const kvSync = require('./kv-sync');
const noteFilesSync = require('./note-files-sync');

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60 * 1_000;   // 5 minutes
const PERIODIC_MS = 60_000;              // 60 seconds
const CONNECTIVITY_MS = 30_000;          // 30 seconds
const CONTENT_DEBOUNCE_MS = 3_000;
const KV_DEBOUNCE_MS = 2_000;
const FILES_DEBOUNCE_MS = 5_000;

// Network error codes that indicate offline/unreachable (not a server bug)
const NET_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ENETUNREACH', 'ECONNRESET']);

class SyncManager extends EventEmitter {
  constructor() {
    super();
    this._state = 'disabled';
    this._paused = false;
    this._workspacePath = null;
    this._syncing = false;
    this._lastSync = null;
    this._backoffCount = 0;
    this._periodicTimer = null;
    this._connectivityTimer = null;
    this._backoffTimer = null;
    this._kvFlushTimer = null;
    this._filesFlushTimer = null;
    this._pushTimers = new Map();
  }

  async init(workspacePath) {
    this._workspacePath = workspacePath;
    noteContentSync.init(workspacePath);
    kvSync.init(workspacePath);
    noteFilesSync.init(workspacePath);
    noteFilesSync.fullScan();
    this._setState('idle');
    this.sync().catch(() => {});  // initial pull
  }

  start() {
    this._periodicTimer = setInterval(() => this.sync().catch(() => {}), PERIODIC_MS);
    this._connectivityTimer = setInterval(() => this._checkConnectivity(), CONNECTIVITY_MS);
  }

  stop() {
    clearInterval(this._periodicTimer);
    clearInterval(this._connectivityTimer);
    clearTimeout(this._backoffTimer);
    this._periodicTimer = null;
    this._connectivityTimer = null;
    this._backoffTimer = null;
  }

  pause() {
    if (this._paused) return;
    this._paused = true;
    this.stop();
    this._setState('paused');
  }

  resume() {
    if (!this._paused) return;
    this._paused = false;
    this._setState('idle');
    this.start();
    this.sync().catch(() => {});
  }

  async sync() {
    if (this._syncing || this._state === 'disabled' || this._paused) return;
    if (!auth.isLoggedIn() || !this._workspacePath) return;
    if (!net.isOnline()) { this._setState('offline'); return; }

    this._syncing = true;
    this._setState('syncing');
    let anyError = null;

    // Sequential: content → KV → files
    const contentResult = await noteContentSync.syncContent().catch(e => { anyError = e; return null; });
    await kvSync.sync().catch(e => { if (!anyError) anyError = e; });
    await noteFilesSync.sync().catch(e => { if (!anyError) anyError = e; });

    this._syncing = false;

    if (this._paused) {
      this._setState('paused');
    } else if (anyError) {
      if (this._isNetworkError(anyError)) {
        this._setState('offline');
      } else {
        this._setState('error');
      }
      this._scheduleBackoff();
    } else {
      this._backoffCount = 0;
      this._lastSync = Date.now();
      this._setState('idle');
      // Forward content sync result for conflict banner backward compat
      if (contentResult?.ok) {
        this.emit('contentSynced', contentResult);
        if (contentResult.conflicts?.length > 0) {
          this.emit('conflictsChanged');
        }
      }
    }
    this.emit('statusChanged', this.getStatus());
  }

  async syncNow() {
    this._cancelBackoff();
    this._backoffCount = 0;
    await this.sync();
  }

  syncKvNow() { return kvSync.sync(); }
  syncFilesNow() { return noteFilesSync.sync(); }
  pushFile(relPath) { return noteContentSync.pushFile(relPath); }

  // Hooks called by main.js IPC handlers

  onKvWrite(noteId, key, value, deleted) {
    if (!auth.isLoggedIn()) return;
    if (this._paused) return;
    kvSync.enqueue(noteId, key, deleted ? null : value, deleted);
    clearTimeout(this._kvFlushTimer);
    this._kvFlushTimer = setTimeout(() => kvSync.flush().catch(() => {}), KV_DEBOUNCE_MS);
  }

  onFileSave(noteId, name) {
    if (!auth.isLoggedIn()) return;
    if (this._paused) return;
    noteFilesSync.enqueueUpload(noteId, name);
    clearTimeout(this._filesFlushTimer);
    this._filesFlushTimer = setTimeout(() => noteFilesSync.flush().catch(() => {}), FILES_DEBOUNCE_MS);
  }

  onFileDelete(noteId, name) {
    if (!auth.isLoggedIn()) return;
    if (this._paused) return;
    noteFilesSync.enqueueDelete(noteId, name);
    clearTimeout(this._filesFlushTimer);
    this._filesFlushTimer = setTimeout(() => noteFilesSync.flush().catch(() => {}), FILES_DEBOUNCE_MS);
  }

  onContentSave(relPath) {
    if (!auth.isLoggedIn() || !this._workspacePath) return;
    if (this._paused) return;
    clearTimeout(this._pushTimers.get(relPath));
    this._pushTimers.set(relPath, setTimeout(async () => {
      this._pushTimers.delete(relPath);
      const result = await noteContentSync.pushFile(relPath).catch(() => null);
      if (result?.ok && result.conflict) {
        this.emit('contentConflict', result.conflict);
      }
    }, CONTENT_DEBOUNCE_MS));
  }

  onContentDelete(relPath) {
    if (!auth.isLoggedIn() || !this._workspacePath) return;
    if (this._paused) return;
    clearTimeout(this._pushTimers.get(relPath));
    this._pushTimers.delete(relPath);
    noteContentSync.handleDeletion(relPath).catch(() => {});
  }

  getStatus() {
    const kv = kvSync.getStatus();        // { queueLength, lastSync, inProgress }
    const files = noteFilesSync.getStatus(); // { uploadQueue, deleteQueue, lastSync, inProgress }
    const content = noteContentSync.getSyncState(); // { lastSync, fileCount, inProgress }
    return {
      state: this._state,                  // 'disabled'|'idle'|'syncing'|'offline'|'error'|'paused'
      paused: this._paused,
      lastSync: this._lastSync,
      pending: (kv.queueLength || 0) + (files.uploadQueue || 0) + (files.deleteQueue || 0),
      content,
      kv,
      files,
    };
  }

  clearState() {
    this.stop();
    this._paused = false;
    noteContentSync.clearSyncState();
    kvSync.clearState();
    noteFilesSync.clearState();
    this._workspacePath = null;
    this._lastSync = null;
    this._backoffCount = 0;
    this._syncing = false;
    this._pushTimers.forEach(t => clearTimeout(t));
    this._pushTimers.clear();
    clearTimeout(this._kvFlushTimer);
    clearTimeout(this._filesFlushTimer);
    this._setState('disabled');
  }

  // Private helpers

  _setState(newState) {
    if (this._state === newState) return;
    this._state = newState;
    this.emit('statusChanged', this.getStatus());
  }

  _scheduleBackoff() {
    if (this._paused) return;
    const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, this._backoffCount), BACKOFF_MAX_MS);
    this._backoffCount++;
    this._backoffTimer = setTimeout(() => this.sync().catch(() => {}), delay);
  }

  _cancelBackoff() {
    clearTimeout(this._backoffTimer);
    this._backoffTimer = null;
  }

  _isNetworkError(err) {
    if (!err) return false;
    if (NET_ERROR_CODES.has(err.code)) return true;
    // Also treat HTTP 503/504 (server unreachable) as network errors
    if (err.statusCode === 503 || err.statusCode === 504) return true;
    return false;
  }

  _checkConnectivity() {
    if (this._paused) return;
    if (this._state !== 'offline') return;
    if (net.isOnline()) {
      this._cancelBackoff();
      this.sync().catch(() => {});
    }
  }
}

module.exports = new SyncManager();
