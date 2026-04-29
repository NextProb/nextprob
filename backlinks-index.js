'use strict';

const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const { collectFiles, toNoteCanonicalPath } = require('./search-index-builder');

const BACKLINKS_EXT = '.html';
const BATCH_SIZE = 20;
const LINK_RE = /href\s*=\s*["']([^"']*\.html)(?:[#?][^"']*)?["']/gi;

// ─── Module state ─────────────────────────────────────────────────────────────

// _sourceToTargets: Map<absSourcePath, Set<absTargetPath>>
// Used for efficient cleanup on file change/delete.
let _sourceToTargets = new Map();

// _targetToSources: Map<absTargetPath, Set<absSourcePath>>
// Reverse index — queried by getBacklinks().
let _targetToSources = new Map();

let _ready = false;
let _watcher = null;
const _timers = new Map(); // per-file debounce timers
const _queue = new Map(); // events queued during initial build

const _emitter = new EventEmitter();

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _extractTargets(content, sourceFile) {
  const targets = new Set();
  const sourceDir = path.dirname(sourceFile);
  LINK_RE.lastIndex = 0;
  let match;
  while ((match = LINK_RE.exec(content)) !== null) {
    const href = match[1];
    if (href.includes('://') || href.startsWith('//')) continue; // external URL
    if (path.isAbsolute(href)) continue; // absolute path — skip for safety
    targets.add(toNoteCanonicalPath(path.resolve(sourceDir, href)));
  }
  return targets;
}

function _removeFile(filePath) {
  const canonicalSource = toNoteCanonicalPath(filePath);
  const oldTargets = _sourceToTargets.get(canonicalSource) || new Set();
  for (const target of oldTargets) {
    const sources = _targetToSources.get(target);
    if (sources) {
      sources.delete(canonicalSource);
      if (sources.size === 0) _targetToSources.delete(target);
    }
  }
  _sourceToTargets.delete(canonicalSource);
  _targetToSources.delete(canonicalSource); // deleted file can no longer receive backlinks
  if (_ready) {
    const affected = new Set([canonicalSource, ...oldTargets]);
    _emitter.emit('backlinks-changed', { affectedTargets: affected });
  }
}

async function _updateFile(filePath) {
  const canonicalSource = toNoteCanonicalPath(filePath);
  const oldTargets = _sourceToTargets.get(canonicalSource) || new Set();
  // Remove old forward links
  for (const target of oldTargets) {
    const sources = _targetToSources.get(target);
    if (sources) {
      sources.delete(canonicalSource);
      if (sources.size === 0) _targetToSources.delete(target);
    }
  }
  _sourceToTargets.delete(canonicalSource);
  // Extract new links
  let newTargets = new Set();
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    newTargets = _extractTargets(content, filePath);
  } catch { /* file unreadable or deleted — treat as no links */ }
  // Add new forward links
  if (newTargets.size > 0) {
    _sourceToTargets.set(canonicalSource, newTargets);
    for (const target of newTargets) {
      if (!_targetToSources.has(target)) _targetToSources.set(target, new Set());
      _targetToSources.get(target).add(canonicalSource);
    }
  }
  if (_ready) {
    const affected = new Set([...oldTargets, ...newTargets]);
    if (affected.size > 0) {
      _emitter.emit('backlinks-changed', { affectedTargets: affected });
    }
  }
}

// ─── Watcher event handler ────────────────────────────────────────────────────

function _isHtml(filePath) {
  return path.extname(filePath).toLowerCase() === BACKLINKS_EXT;
}

function _handleEvent(event, filePath) {
  if (!_isHtml(filePath)) return;
  if (event === 'unlink') {
    if (_timers.has(filePath)) { clearTimeout(_timers.get(filePath)); _timers.delete(filePath); }
    if (!_ready) { _queue.set(filePath, 'unlink'); return; }
    _removeFile(filePath);
    return;
  }
  // add or change
  if (!_ready) {
    if (_timers.has(filePath)) { clearTimeout(_timers.get(filePath)); _timers.delete(filePath); }
    _queue.set(filePath, event);
    return;
  }
  if (_timers.has(filePath)) clearTimeout(_timers.get(filePath));
  const timerId = setTimeout(() => { _timers.delete(filePath); _updateFile(filePath); }, 300);
  _timers.set(filePath, timerId);
}

// ─── Public API ───────────────────────────────────────────────────────────────

function init() {
  _sourceToTargets = new Map();
  _targetToSources = new Map();
}

async function buildIndex(wsPath, options = {}) {
  const { signal } = options;
  const startTime = Date.now();
  const allFiles = collectFiles(wsPath);
  const files = allFiles.filter(f => f.ext === BACKLINKS_EXT);
  let processed = 0;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = files.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(({ fullPath }) => _updateFile(fullPath)));
    processed += batch.length;
    await new Promise(r => setImmediate(r)); // yield to event loop between batches
  }
  const elapsed = Date.now() - startTime;
  console.log(`[backlinks-index] build complete: ${processed} files in ${elapsed}ms`);
  _emitter.emit('build-complete', { total: processed, elapsed });
  return { indexed: processed, elapsed };
}

function start(watcher) {
  _watcher = watcher;
  watcher.on('add',    fp => _handleEvent('add',    fp));
  watcher.on('change', fp => _handleEvent('change', fp));
  watcher.on('unlink', fp => _handleEvent('unlink', fp));
}

function stop() {
  for (const timerId of _timers.values()) clearTimeout(timerId);
  _timers.clear();
  _queue.clear();
  _ready = false;
  _watcher = null;
}

function setReady(ready) {
  if (ready && !_ready) {
    _ready = true;
    if (_queue.size > 0) {
      console.log('[backlinks-index] replaying', _queue.size, 'queued events');
      for (const [filePath, event] of _queue) {
        if (event === 'unlink') _removeFile(filePath);
        else _updateFile(filePath);
      }
      _queue.clear();
    }
  } else if (!ready) {
    _ready = false;
    _queue.clear();
  }
}

/**
 * Returns absolute paths of files that link to the given absolute file path.
 * @param {string} absoluteFilePath
 * @returns {string[]}
 */
function getBacklinks(absoluteFilePath) {
  const set = _targetToSources.get(absoluteFilePath);
  return set ? [...set] : [];
}

/**
 * Returns the forward-link map. Exposed for future graph view (feature 127).
 * @returns {Map<string, Set<string>>}
 */
function getSourceToTargets() {
  return _sourceToTargets;
}

/**
 * Subscribe to events.
 *   'backlinks-changed' { affectedTargets: Set<absPath> } — live mode only
 *   'build-complete'    { total, elapsed }                — end of buildIndex()
 */
function on(event, handler) {
  _emitter.on(event, handler);
}

module.exports = { init, buildIndex, start, stop, setReady, getBacklinks, getSourceToTargets, on };
