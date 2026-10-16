'use strict';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// ─── Module state ─────────────────────────────────────────────────────────────

let _registry = new Map();   // Map<id, TemplateEntry>
let _templatesPath = null;   // absolute path to _templates/
let _ready = false;

// Per-path debounce timers: Map<dirPath, timerId>
const _timers = new Map();

// Event queue for events that arrive before the initial build completes.
// Map<dirPath, 'addDir'|'unlinkDir'> — last event per path wins.
const _queue = new Map();

const _emitter = new EventEmitter();

let _emitTimer = null; // debounce timer for registry-changed emission

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns true if dirPath is a direct subdirectory of _templates/
 * (not _templates/ itself, not deeper nested, not dotfiles).
 * @param {string} dirPath
 * @returns {boolean}
 */
function _isTemplateDir(dirPath) {
  if (!_templatesPath) return false;
  if (path.dirname(dirPath) !== _templatesPath) return false;
  const name = path.basename(dirPath);
  if (name.startsWith('.')) return false;
  return true;
}

/**
 * Build a template entry from a directory.
 * Returns { id, name, path } or null if not a valid template folder.
 * @param {string} dirPath
 * @returns {{ id: string, name: string, path: string }|null}
 */
function _parseTemplateDir(dirPath) {
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return null;
    const id = path.basename(dirPath);
    return { id, name: id, path: dirPath };
  } catch (err) {
    console.warn(`[templates-registry] skipping ${dirPath}: ${err.message}`);
    return null;
  }
}

/**
 * Schedule a debounced 'registry-changed' emission (100ms).
 * Coalesces multiple near-simultaneous changes into one event.
 */
function _scheduleEmit() {
  clearTimeout(_emitTimer);
  _emitTimer = setTimeout(() => {
    _emitter.emit('registry-changed');
  }, 100);
}

/**
 * Parse dirPath and add/update its entry in the registry.
 * On parse failure, removes the entry if it previously existed.
 * @param {string} dirPath
 */
function _addOrUpdate(dirPath) {
  const entry = _parseTemplateDir(dirPath);
  if (entry) {
    _registry.set(entry.id, entry);
  } else {
    const id = path.basename(dirPath);
    _registry.delete(id);
  }
  _scheduleEmit();
}

/**
 * Remove the registry entry for dirPath.
 * @param {string} dirPath
 */
function _remove(dirPath) {
  const id = path.basename(dirPath);
  if (_registry.has(id)) {
    _registry.delete(id);
    _scheduleEmit();
  }
}

/**
 * Handle a chokidar watcher event for directories.
 * Filters to template directories only, debounces addDir, handles unlinkDir immediately.
 * @param {'addDir'|'unlinkDir'} event
 * @param {string} dirPath
 */
function _handleEvent(event, dirPath) {
  if (!_isTemplateDir(dirPath)) return;

  if (event === 'unlinkDir') {
    if (_timers.has(dirPath)) {
      clearTimeout(_timers.get(dirPath));
      _timers.delete(dirPath);
    }
    if (!_ready) {
      _queue.set(dirPath, 'unlinkDir');
      return;
    }
    _remove(dirPath);
    return;
  }

  // addDir
  if (!_ready) {
    if (_timers.has(dirPath)) {
      clearTimeout(_timers.get(dirPath));
      _timers.delete(dirPath);
    }
    _queue.set(dirPath, event);
    return;
  }

  // Debounce per directory (live mode only) — 300ms
  if (_timers.has(dirPath)) clearTimeout(_timers.get(dirPath));
  const timerId = setTimeout(() => {
    _timers.delete(dirPath);
    _addOrUpdate(dirPath);
  }, 300);
  _timers.set(dirPath, timerId);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reset registry state. Call before buildRegistry() for a new workspace.
 * @param {string} templatesPath — absolute path to the _templates/ directory
 */
function init(templatesPath) {
  _registry = new Map();
  _templatesPath = path.resolve(templatesPath);
  for (const timerId of _timers.values()) clearTimeout(timerId);
  _timers.clear();
  _queue.clear();
  _ready = false;
  clearTimeout(_emitTimer);
  _emitTimer = null;
}

/**
 * Synchronous initial scan of _templatesPath.
 * Reads all subdirectories and populates the registry.
 * Skips dotfiles and non-directories.
 * Call after init() and before setReady(true).
 */
function buildRegistry() {
  if (!_templatesPath) return;
  _registry = new Map();
  let entries;
  try {
    entries = fs.readdirSync(_templatesPath);
  } catch (err) {
    console.warn(`[templates-registry] cannot read ${_templatesPath}: ${err.message}`);
    return;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const dirPath = path.join(_templatesPath, name);
    const entry = _parseTemplateDir(dirPath);
    if (entry) _registry.set(entry.id, entry);
  }
  console.log(`[templates-registry] build complete: ${_registry.size} templates`);
}

/**
 * Attach registry listeners to an existing chokidar watcher.
 * @param {import('chokidar').FSWatcher} watcher
 */
function start(watcher) {
  watcher.on('addDir',    (fp) => _handleEvent('addDir',    fp));
  watcher.on('unlinkDir', (fp) => _handleEvent('unlinkDir', fp));
}

/**
 * Cancel all pending debounce timers and reset ready state.
 */
function stop() {
  for (const timerId of _timers.values()) clearTimeout(timerId);
  _timers.clear();
  _queue.clear();
  _ready = false;
  clearTimeout(_emitTimer);
  _emitTimer = null;
}

/**
 * Toggle build/live mode.
 * @param {boolean} ready
 */
function setReady(ready) {
  if (ready && !_ready) {
    _ready = true;
    if (_queue.size > 0) {
      console.log('[templates-registry] replaying', _queue.size, 'queued events');
      for (const [dirPath, event] of _queue) {
        if (event === 'unlinkDir') {
          _remove(dirPath);
        } else {
          _addOrUpdate(dirPath);
        }
      }
      _queue.clear();
    }
  } else if (!ready) {
    _ready = false;
    _queue.clear();
  }
}

/**
 * Return the current registry as an array of TemplateEntry objects.
 * @returns {{ id: string, name: string, path: string }[]}
 */
function getAll() {
  return [..._registry.values()];
}

/**
 * Subscribe to registry events.
 * @param {'registry-changed'} event
 * @param {Function} handler
 */
function on(event, handler) {
  _emitter.on(event, handler);
}

module.exports = { init, buildRegistry, start, stop, setReady, getAll, on };
