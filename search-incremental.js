'use strict';

const fs = require('fs');
const path = require('path');
const searchIndex = require('./search-index');
const { extractTitleFromContent, extractBodyFromContent, toNoteCanonicalPath, INDEXABLE_EXTS, SIZE_LIMIT } = require('./search-index-builder');

// ─── Module state ─────────────────────────────────────────────────────────────

let _ready = false;
let _watcher = null;

// Per-file debounce timers: Map<filePath, timerId>
const _timers = new Map();

// Event queue for events that arrive before the initial build completes.
// Each entry: { event: 'add'|'change'|'unlink', filePath: string }
// Only the LAST event per path is kept (deduplication on push).
const _queue = new Map(); // Map<filePath, 'add'|'change'|'unlink'>

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isIndexable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return INDEXABLE_EXTS.has(ext);
}

function indexFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let stat;
  try { stat = fs.statSync(filePath); } catch { return; } // file gone between event and read
  if (stat.size > SIZE_LIMIT) return;

  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return; }

  const title = extractTitleFromContent(content, filePath, ext);
  const body = extractBodyFromContent(content, ext);
  const canonicalPath = toNoteCanonicalPath(filePath);
  searchIndex.update(canonicalPath, title, body, stat.mtimeMs);
  console.log('[search-incremental] indexed', canonicalPath);
}

function removeFile(filePath) {
  const canonicalPath = toNoteCanonicalPath(filePath);
  searchIndex.remove(canonicalPath);
  console.log('[search-incremental] removed', canonicalPath);
}

// ─── Event handler ────────────────────────────────────────────────────────────

function handleEvent(event, filePath) {
  if (!isIndexable(filePath)) return;
  // Skip files inside _templates/ — they are not regular notes (feature 111)
  if (filePath.includes(path.sep + '_templates' + path.sep) ||
      filePath.endsWith(path.sep + '_templates')) return;

  if (event === 'unlink') {
    // Clear any pending add/change timer — no point indexing a deleted file.
    if (_timers.has(filePath)) {
      clearTimeout(_timers.get(filePath));
      _timers.delete(filePath);
    }

    if (!_ready) {
      _queue.set(filePath, 'unlink');
      return;
    }
    removeFile(filePath);
    return;
  }

  // add or change
  if (!_ready) {
    // Queue immediately — debouncing is unnecessary during build since
    // the Map already deduplicates by path.
    if (_timers.has(filePath)) {
      clearTimeout(_timers.get(filePath));
      _timers.delete(filePath);
    }
    _queue.set(filePath, event);
    return;
  }

  // Debounce per file (live mode only)
  if (_timers.has(filePath)) {
    clearTimeout(_timers.get(filePath));
  }

  const timerId = setTimeout(() => {
    _timers.delete(filePath);
    indexFile(filePath);
  }, 300);

  _timers.set(filePath, timerId);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attach incremental indexing listeners to an existing chokidar watcher.
 * Must be called after the watcher has been created.
 *
 * @param {import('chokidar').FSWatcher} watcher
 */
function start(watcher) {
  _watcher = watcher;
  watcher.on('add',    (filePath) => handleEvent('add',    filePath));
  watcher.on('change', (filePath) => handleEvent('change', filePath));
  watcher.on('unlink', (filePath) => handleEvent('unlink', filePath));
}

/**
 * Remove listeners and cancel all pending debounce timers.
 * Call before closing the watcher or switching workspaces.
 */
function stop() {
  for (const timerId of _timers.values()) clearTimeout(timerId);
  _timers.clear();
  _queue.clear();
  _ready = false;
  _watcher = null;
}

/**
 * Signal whether the initial index build has completed.
 *
 * Call setReady(false) before starting a new buildIndex() run so that
 * any file events arriving during the build are queued.
 *
 * Call setReady(true) after buildIndex() resolves to replay queued events
 * and switch to live mode.
 *
 * @param {boolean} ready
 */
function setReady(ready) {
  if (ready && !_ready) {
    _ready = true;
    if (_queue.size > 0) {
      console.log('[search-incremental] replaying', _queue.size, 'queued events');
      for (const [filePath, event] of _queue) {
        if (event === 'unlink') {
          removeFile(filePath);
        } else {
          indexFile(filePath);
        }
      }
      _queue.clear();
    }
  } else if (!ready) {
    _ready = false;
    _queue.clear();
  }
}

module.exports = { start, stop, setReady };
