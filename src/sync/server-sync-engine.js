'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const syncIgnore = require('./sync-ignore');

class ServerSyncEngine {
  constructor(endpointId, workspacePath, stateDir) {
    this._endpointId = endpointId;
    this._workspacePath = workspacePath;
    this._stateDir = stateDir;
    this._syncState = { lastSyncTimestamp: 0, localHashes: {}, remoteHashes: {}, remoteStats: {} };
    this._syncInProgress = false;
    this._loadSyncState();
  }

  _statePath() {
    return path.join(this._stateDir, 'server-sync-state.json');
  }

  _loadSyncState() {
    try {
      const raw = fs.readFileSync(this._statePath(), 'utf8');
      this._syncState = JSON.parse(raw);
    } catch {
      this._syncState = { lastSyncTimestamp: 0, localHashes: {}, remoteHashes: {}, remoteStats: {} };
    }
  }

  _saveSyncState() {
    try {
      fs.mkdirSync(this._stateDir, { recursive: true });
      fs.writeFileSync(this._statePath(), JSON.stringify(this._syncState, null, 2), 'utf8');
    } catch (err) {
      console.error(`[server-sync-engine:${this._endpointId}] Failed to save state:`, err.message);
    }
  }

  // ─── Local hash computation (mirrors note-content-sync.js) ─────────────

  _computeLocalHashes() {
    const ig = syncIgnore.loadIgnore(this._workspacePath);
    const hashes = {};
    this._walkDir(this._workspacePath, this._workspacePath, hashes, ig);
    return hashes;
  }

  _walkDir(baseDir, currentDir, hashes, ig) {
    let entries;
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(currentDir, entry.name);
      const rel = path.relative(baseDir, abs).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (ig.ignores(rel + '/')) continue;
        this._walkDir(baseDir, abs, hashes, ig);
      } else if (entry.isFile()) {
        if (ig.ignores(rel)) continue;
        try {
          const content = fs.readFileSync(abs);
          hashes[rel] = crypto.createHash('md5').update(content).digest('hex');
        } catch { /* skip unreadable */ }
      }
    }
  }

  _hashBuffer(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  _hashLocalFile(relPath) {
    try {
      const content = fs.readFileSync(path.join(this._workspacePath, relPath));
      return crypto.createHash('md5').update(content).digest('hex');
    } catch { return null; }
  }

  // ─── Full sync cycle ───────────────────────────────────────────────────

  async syncContent(sftp) {
    if (this._syncInProgress) return { ok: false, error: 'sync-in-progress' };
    this._syncInProgress = true;
    try {
      return await this._doSync(sftp);
    } finally {
      this._syncInProgress = false;
    }
  }

  async _doSync(sftp) {
    const isFirstSync = this._syncState.lastSyncTimestamp === 0;

    // 1. Compute local hashes
    const ig = syncIgnore.loadIgnore(this._workspacePath);
    const localHashes = this._computeLocalHashes();

    // 2. List remote files
    const remoteFiles = await sftp.listFiles(sftp._remotePath, ig);
    const remoteIndex = {}; // relPath → { mtime, size }
    for (const f of remoteFiles) {
      remoteIndex[f.relPath] = { mtime: f.mtime, size: f.size };
    }

    // 3. Download files with changed mtime/size, compute their MD5
    const remoteHashes = {};
    const prevRemoteStats = this._syncState.remoteStats || {};
    const prevRemoteHashes = this._syncState.remoteHashes || {};

    for (const f of remoteFiles) {
      const prev = prevRemoteStats[f.relPath];
      if (prev && prev.mtime === f.mtime && prev.size === f.size && prevRemoteHashes[f.relPath]) {
        // Unchanged — reuse cached hash
        remoteHashes[f.relPath] = prevRemoteHashes[f.relPath];
      } else {
        // Changed or new — download and hash
        try {
          const buf = await sftp.readFile(sftp._remotePath + '/' + f.relPath);
          remoteHashes[f.relPath] = this._hashBuffer(buf);
          // Write to local if needed (handled in classification below, but cache buf)
          f._buffer = buf;
        } catch (err) {
          console.error(`[server-sync-engine] Failed to read remote: ${f.relPath}`, err.message);
        }
      }
    }

    // 4. Classify each file
    const allPaths = new Set([...Object.keys(localHashes), ...Object.keys(remoteHashes)]);
    const prevLocalHashes = this._syncState.localHashes || {};

    let uploaded = 0;
    let downloaded = 0;
    const conflicts = [];

    for (const relPath of allPaths) {
      const hasLocal = relPath in localHashes;
      const hasRemote = relPath in remoteHashes;
      const localHash = localHashes[relPath];
      const remoteHash = remoteHashes[relPath];

      if (localHash === remoteHash) {
        // Already in sync — no action needed
        continue;
      }

      if (hasLocal && !hasRemote) {
        if (!isFirstSync && prevRemoteHashes[relPath]) {
          // Was on server before, now gone → remote deleted it
          const localEdited = localHash !== prevLocalHashes[relPath];
          if (localEdited) {
            // Local was edited while remote deleted → conflict (edit vs delete)
            conflicts.push({ local: relPath, conflict: null, type: 'edit-vs-delete' });
          } else {
            // Local unchanged → safe to propagate remote deletion
            try { fs.unlinkSync(path.join(this._workspacePath, relPath)); } catch {}
            downloaded++;
          }
        } else {
          // Never on server → new local file, upload
          await this._uploadFile(sftp, relPath);
          uploaded++;
        }
        continue;
      }

      if (!hasLocal && hasRemote) {
        if (!isFirstSync && prevLocalHashes[relPath]) {
          // Was local before, now gone → local deleted it
          const remoteEdited = remoteHash !== prevRemoteHashes[relPath];
          if (remoteEdited) {
            // Remote was edited while local deleted → conflict (delete vs edit)
            const fileEntry = remoteFiles.find(f => f.relPath === relPath);
            const buf = fileEntry?._buffer || await sftp.readFile(sftp._remotePath + '/' + relPath);
            const conflictPath = this._conflictFilePath(relPath);
            this._writeLocal(conflictPath, buf);
            conflicts.push({ local: relPath, conflict: conflictPath, type: 'delete-vs-edit' });
          } else {
            // Remote unchanged → safe to propagate local deletion
            try { await sftp.deleteFile(sftp._remotePath + '/' + relPath); } catch {}
            uploaded++;
          }
        } else {
          // Never local → new remote file, download
          const fileEntry = remoteFiles.find(f => f.relPath === relPath);
          const buf = fileEntry?._buffer || await sftp.readFile(sftp._remotePath + '/' + relPath);
          this._writeLocal(relPath, buf);
          downloaded++;
        }
        continue;
      }

      // Both exist but different hashes — check what changed since last sync
      const prevLocal = prevLocalHashes[relPath];
      const prevRemote = prevRemoteHashes[relPath];

      if (isFirstSync) {
        // First sync: hashes differ → conflict (unless matching, handled above)
        const fileEntry = remoteFiles.find(f => f.relPath === relPath);
        const buf = fileEntry?._buffer || await sftp.readFile(sftp._remotePath + '/' + relPath);
        const conflictPath = this._conflictFilePath(relPath);
        this._writeLocal(conflictPath, buf);
        conflicts.push({ local: relPath, conflict: conflictPath });
        continue;
      }

      const localChanged = localHash !== prevLocal;
      const remoteChanged = remoteHash !== prevRemote;

      if (localChanged && !remoteChanged) {
        // Only local changed → upload
        await this._uploadFile(sftp, relPath);
        uploaded++;
      } else if (!localChanged && remoteChanged) {
        // Only remote changed → download
        const fileEntry = remoteFiles.find(f => f.relPath === relPath);
        const buf = fileEntry?._buffer || await sftp.readFile(sftp._remotePath + '/' + relPath);
        this._writeLocal(relPath, buf);
        downloaded++;
      } else {
        // Both changed → conflict
        const fileEntry = remoteFiles.find(f => f.relPath === relPath);
        const buf = fileEntry?._buffer || await sftp.readFile(sftp._remotePath + '/' + relPath);
        const conflictPath = this._conflictFilePath(relPath);
        this._writeLocal(conflictPath, buf);
        conflicts.push({ local: relPath, conflict: conflictPath });
      }
    }

    // 5. Update sync state
    const updatedLocalHashes = this._computeLocalHashes();
    this._syncState = {
      lastSyncTimestamp: Date.now(),
      localHashes: updatedLocalHashes,
      remoteHashes,
      remoteStats: remoteIndex,
    };
    this._saveSyncState();

    return { ok: true, uploaded, downloaded, conflicts };
  }

  _writeLocal(relPath, buffer) {
    const absPath = path.join(this._workspacePath, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, buffer);
  }

  async _uploadFile(sftp, relPath) {
    const absPath = path.join(this._workspacePath, relPath);
    let buffer;
    try { buffer = fs.readFileSync(absPath); } catch { return; }
    const remotePath = sftp._remotePath + '/' + relPath;
    await sftp.writeFile(remotePath, buffer);
  }

  _conflictFilePath(relPath) {
    const ts = Date.now();
    const ext = path.extname(relPath);
    const base = relPath.slice(0, relPath.length - ext.length);
    return `${base}.conflict.${ts}${ext}`;
  }

  // ─── Single-file push ──────────────────────────────────────────────────

  async pushFile(sftp, relPath) {
    const hash = this._hashLocalFile(relPath);
    if (!hash) return { ok: false, error: 'file-not-readable' };

    try {
      await this._uploadFile(sftp, relPath);
      // After upload the server now holds this content. Mirror that in both
      // localHashes AND remoteHashes + remoteStats so the next full sync
      // doesn't misread our own push as a remote-side change.
      this._syncState.localHashes[relPath] = hash;
      this._syncState.remoteHashes[relPath] = hash;
      try {
        const stats = await sftp.stat(sftp._remotePath + '/' + relPath);
        this._syncState.remoteStats[relPath] = {
          mtime: stats.mtime * 1000,
          size: stats.size,
        };
      } catch {
        // If stat fails, drop cached stats so the next full sync re-reads
        // this file instead of trusting a stale entry.
        delete this._syncState.remoteStats[relPath];
      }
      this._syncState.lastSyncTimestamp = Date.now();
      this._saveSyncState();
      return { ok: true, uploaded: 1 };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ─── Status ────────────────────────────────────────────────────────────

  getSyncState() {
    return {
      lastSyncTimestamp: this._syncState.lastSyncTimestamp,
      fileCount: Object.keys(this._syncState.localHashes).length,
      syncInProgress: this._syncInProgress,
    };
  }

  clearSyncState() {
    this._syncState = { lastSyncTimestamp: 0, localHashes: {}, remoteHashes: {}, remoteStats: {} };
    this._saveSyncState();
  }
}

module.exports = { ServerSyncEngine };
