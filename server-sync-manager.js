'use strict';

const EventEmitter = require('events');
const { ServerSftp } = require('./server-sftp');
const { ServerSyncEngine } = require('./server-sync-engine');

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60 * 1_000;
const PERIODIC_MS = 300_000;            // 5 minutes
const CONTENT_DEBOUNCE_MS = 3_000;

const NET_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ENETUNREACH', 'ECONNRESET']);

class ServerSyncManager extends EventEmitter {
  constructor() {
    super();
    this._endpoints = new Map(); // endpointId → { engine, sftp, config, state, timers }
    this._workspacePath = null;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  initEndpoint(endpointId, workspacePath, sshConfig) {
    this._workspacePath = workspacePath;

    // Clean up existing if re-initializing
    if (this._endpoints.has(endpointId)) {
      this.removeEndpoint(endpointId);
    }

    const sshSyncAuth = require('./providers/ssh-sync-auth');
    const stateDir = sshSyncAuth.getEndpointDir(endpointId);

    const sftp = new ServerSftp(sshConfig);
    const engine = new ServerSyncEngine(endpointId, workspacePath, stateDir);

    const entry = {
      engine,
      sftp,
      config: sshConfig,
      state: 'idle',
      timers: { periodic: null, backoff: null },
      backoffCount: 0,
      pushTimers: new Map(),
    };

    this._endpoints.set(endpointId, entry);
    this._setEndpointState(endpointId, 'idle');
  }

  start() {
    for (const [id, entry] of this._endpoints) {
      if (entry.state === 'paused') continue;
      clearInterval(entry.timers.periodic);
      entry.timers.periodic = setInterval(() => this._syncEndpoint(id).catch(() => {}), PERIODIC_MS);
      // Initial sync
      this._syncEndpoint(id).catch(() => {});
    }
  }

  startEndpoint(endpointId) {
    const entry = this._endpoints.get(endpointId);
    if (!entry) return;
    clearInterval(entry.timers.periodic);
    entry.timers.periodic = setInterval(() => this._syncEndpoint(endpointId).catch(() => {}), PERIODIC_MS);
    this._syncEndpoint(endpointId).catch(() => {});
  }

  stop() {
    for (const [, entry] of this._endpoints) {
      clearInterval(entry.timers.periodic);
      clearTimeout(entry.timers.backoff);
      entry.timers.periodic = null;
      entry.timers.backoff = null;
    }
  }

  stopEndpoint(endpointId) {
    const entry = this._endpoints.get(endpointId);
    if (!entry) return;
    clearInterval(entry.timers.periodic);
    clearTimeout(entry.timers.backoff);
    entry.timers.periodic = null;
    entry.timers.backoff = null;
    entry.sftp.disconnect();
    this._setEndpointState(endpointId, 'disabled');
  }

  pauseEndpoint(endpointId) {
    const entry = this._endpoints.get(endpointId);
    if (!entry || entry.state === 'disabled' || entry.state === 'paused') return;
    clearInterval(entry.timers.periodic);
    clearTimeout(entry.timers.backoff);
    entry.timers.periodic = null;
    entry.timers.backoff = null;
    this._setEndpointState(endpointId, 'paused');
  }

  resumeEndpoint(endpointId) {
    const entry = this._endpoints.get(endpointId);
    if (!entry || entry.state !== 'paused') return;
    this._setEndpointState(endpointId, 'idle');
    clearInterval(entry.timers.periodic);
    entry.timers.periodic = setInterval(() => this._syncEndpoint(endpointId).catch(() => {}), PERIODIC_MS);
    this._syncEndpoint(endpointId).catch(() => {});
  }

  pauseAll() {
    for (const [id, entry] of this._endpoints) {
      if (entry.state !== 'disabled') this.pauseEndpoint(id);
    }
  }

  resumeAll() {
    for (const [id, entry] of this._endpoints) {
      if (entry.state === 'paused') this.resumeEndpoint(id);
    }
  }

  removeEndpoint(endpointId) {
    const entry = this._endpoints.get(endpointId);
    if (!entry) return;
    clearInterval(entry.timers.periodic);
    clearTimeout(entry.timers.backoff);
    entry.pushTimers.forEach(t => clearTimeout(t));
    entry.sftp.disconnect();
    this._endpoints.delete(endpointId);
  }

  // ─── Sync ────────────────────────────────────────────────────────────────

  async _syncEndpoint(endpointId) {
    const entry = this._endpoints.get(endpointId);
    if (!entry) return;
    if (entry.state === 'syncing' || entry.state === 'disabled' || entry.state === 'paused') return;

    this._setEndpointState(endpointId, 'syncing');

    try {
      if (!entry.sftp.isConnected()) {
        await entry.sftp.connect();
      }

      const result = await entry.engine.syncContent(entry.sftp);

      entry.backoffCount = 0;
      this._setEndpointState(endpointId, 'idle');

      if (result?.ok) {
        this.emit('contentSynced', { endpointId, ...result });
        if (result.conflicts?.length > 0) {
          for (const c of result.conflicts) {
            this.emit('contentConflict', c);
          }
          this.emit('conflictsChanged');
        }
      }
    } catch (err) {
      if (this._isNetworkError(err)) {
        this._setEndpointState(endpointId, 'offline');
      } else {
        this._setEndpointState(endpointId, 'error');
        console.error(`[server-sync-manager:${endpointId}] Sync error:`, err.message);
      }
      entry.sftp.disconnect();
      this._scheduleBackoff(endpointId);
    }
  }

  async syncNow(endpointId) {
    const entry = this._endpoints.get(endpointId);
    if (!entry) return { ok: false, error: 'endpoint-not-found' };
    clearTimeout(entry.timers.backoff);
    entry.backoffCount = 0;
    await this._syncEndpoint(endpointId);
    return entry.engine.getSyncState();
  }

  // ─── File watcher hooks ──────────────────────────────────────────────────

  onContentSave(relPath) {
    for (const [id, entry] of this._endpoints) {
      if (entry.state === 'disabled' || entry.state === 'paused') continue;
      clearTimeout(entry.pushTimers.get(relPath));
      entry.pushTimers.set(relPath, setTimeout(async () => {
        entry.pushTimers.delete(relPath);
        try {
          if (!entry.sftp.isConnected()) await entry.sftp.connect();
          const result = await entry.engine.pushFile(entry.sftp, relPath);
          if (result?.ok && result.conflict) {
            this.emit('contentConflict', result.conflict);
          }
        } catch (err) {
          console.error(`[server-sync-manager:${id}] Push error for ${relPath}:`, err.message);
        }
      }, CONTENT_DEBOUNCE_MS));
    }
  }

  onContentDelete(relPath) {
    for (const [, entry] of this._endpoints) {
      if (entry.state === 'disabled' || entry.state === 'paused') continue;
      clearTimeout(entry.pushTimers.get(relPath));
      entry.pushTimers.delete(relPath);
      // Remote deletion: remove from remote via SFTP
      if (entry.sftp.isConnected()) {
        const remotePath = entry.config.remotePath + '/' + relPath;
        entry.sftp._sftp?.unlink(remotePath, () => {});
      }
    }
  }

  // ─── Status ──────────────────────────────────────────────────────────────

  getStatus() {
    const result = {};
    for (const [id, entry] of this._endpoints) {
      result[id] = {
        state: entry.state,
        ...entry.engine.getSyncState(),
      };
    }
    return result;
  }

  getEndpointStatus(endpointId) {
    const entry = this._endpoints.get(endpointId);
    if (!entry) return null;
    return {
      state: entry.state,
      ...entry.engine.getSyncState(),
    };
  }

  hasEndpoint(endpointId) {
    return this._endpoints.has(endpointId);
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  _setEndpointState(endpointId, newState) {
    const entry = this._endpoints.get(endpointId);
    if (!entry || entry.state === newState) return;
    entry.state = newState;
    this.emit('statusChanged', { endpointId, state: newState, ...entry.engine.getSyncState() });
  }

  _scheduleBackoff(endpointId) {
    const entry = this._endpoints.get(endpointId);
    if (!entry || entry.state === 'paused') return;
    const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, entry.backoffCount), BACKOFF_MAX_MS);
    entry.backoffCount++;
    entry.timers.backoff = setTimeout(() => this._syncEndpoint(endpointId).catch(() => {}), delay);
  }

  _isNetworkError(err) {
    if (!err) return false;
    if (NET_ERROR_CODES.has(err.code)) return true;
    if (err.level === 'client-timeout' || err.level === 'client-socket') return true;
    return false;
  }
}

module.exports = new ServerSyncManager();
