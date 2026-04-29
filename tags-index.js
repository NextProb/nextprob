'use strict';

const path = require('path');
const EventEmitter = require('events');
const { parseTagsFromFile } = require('./tags');
const { collectFiles, toNoteCanonicalPath } = require('./search-index-builder');

// Tags are only stored in .html and .md files (not .txt)
const TAGS_EXTS = new Set(['.html', '.md']);
const BATCH_SIZE = 20;

// ─── Module state ─────────────────────────────────────────────────────────────

// _tagToFiles: Map<normalizedTag (lowercase), Set<absoluteFilePath>>
// Used by getAllTags() and getFilesByTag().
let _tagToFiles = new Map();

// _fileToTags: Map<absoluteFilePath, string[]> — original-case tags
// Used by getTagsForFile() and for efficient cleanup on change/delete.
let _fileToTags = new Map();

let _ready = false;
let _watcher = null;

// Per-file debounce timers: Map<filePath, timerId>
const _timers = new Map();

// Event queue for events that arrive before the initial build completes.
// Map<filePath, 'add'|'change'|'unlink'> — last event per path wins.
const _queue = new Map();

// ─── EventEmitter ─────────────────────────────────────────────────────────────

const _emitter = new EventEmitter();

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Remove a file from both maps.
 * In live mode (_ready === true), emits 'tags-changed' if the file had any tags.
 * @param {string} filePath
 */
function _removeFile(filePath) {
  const canonicalPath = toNoteCanonicalPath(filePath);
  const oldTags = _fileToTags.get(canonicalPath) || [];
  for (const tag of oldTags) {
    const key = tag.toLowerCase();
    const set = _tagToFiles.get(key);
    if (set) {
      set.delete(canonicalPath);
      if (set.size === 0) _tagToFiles.delete(key);
    }
  }
  _fileToTags.delete(canonicalPath);
  if (_ready && oldTags.length > 0) {
    _emitter.emit('tags-changed', { filePath: canonicalPath, oldTags, newTags: [] });
  }
}

/**
 * Parse tags from filePath and update both maps.
 * Implements a "remove-then-add" approach so it handles new, modified, and
 * renamed files uniformly.
 * In live mode, emits 'tags-changed' if the tag set actually changed.
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function _updateFile(filePath) {
  const canonicalPath = toNoteCanonicalPath(filePath);
  const oldTags = _fileToTags.get(canonicalPath) || [];

  // Clean slate: remove old entries
  for (const tag of oldTags) {
    const key = tag.toLowerCase();
    const set = _tagToFiles.get(key);
    if (set) {
      set.delete(canonicalPath);
      if (set.size === 0) _tagToFiles.delete(key);
    }
  }
  _fileToTags.delete(canonicalPath);

  // Parse new tags from the actual file (filePath may be index.html for notes)
  const newTags = await parseTagsFromFile(filePath);

  if (newTags.length > 0) {
    _fileToTags.set(canonicalPath, newTags);
    for (const tag of newTags) {
      const key = tag.toLowerCase();
      if (!_tagToFiles.has(key)) _tagToFiles.set(key, new Set());
      _tagToFiles.get(key).add(canonicalPath);
    }
  }

  // Emit tags-changed in live mode if the tag set actually changed.
  // Tags are compared in original order (arrays returned by parseTagsFromFile).
  if (_ready) {
    const changed =
      oldTags.length !== newTags.length ||
      oldTags.some((t, i) => t !== newTags[i]);
    if (changed) {
      _emitter.emit('tags-changed', { filePath: canonicalPath, oldTags, newTags });
    }
  }
}

// ─── Watcher event handler ────────────────────────────────────────────────────

function _isTaggable(filePath) {
  return TAGS_EXTS.has(path.extname(filePath).toLowerCase());
}

function _handleEvent(event, filePath) {
  if (!_isTaggable(filePath)) return;

  if (event === 'unlink') {
    // Clear any pending add/change timer — no point parsing a deleted file.
    if (_timers.has(filePath)) {
      clearTimeout(_timers.get(filePath));
      _timers.delete(filePath);
    }
    if (!_ready) {
      _queue.set(filePath, 'unlink');
      return;
    }
    _removeFile(filePath);
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
  if (_timers.has(filePath)) clearTimeout(_timers.get(filePath));
  const timerId = setTimeout(() => {
    _timers.delete(filePath);
    _updateFile(filePath);
  }, 300);
  _timers.set(filePath, timerId);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reset internal state. Call before starting a new buildIndex() run.
 */
function init() {
  _tagToFiles = new Map();
  _fileToTags = new Map();
}

/**
 * Scan wsPath and populate the index. Files are processed in batches of 20,
 * yielding the event loop between batches.
 *
 * Call init() before calling buildIndex().
 * Call setReady(false) before calling buildIndex() and setReady(true) after.
 *
 * @param {string} wsPath
 * @param {object} [options]
 * @param {function(current: number, total: number): void} [options.onProgress]
 *   Called after each batch when total > 500.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ indexed: number, elapsed: number }>}
 */
async function buildIndex(wsPath, options = {}) {
  const { onProgress, signal } = options;
  const startTime = Date.now();

  // collectFiles returns { fullPath, mtimeMs, ext }[] for .html, .md, .txt
  // Filter to only the extensions that carry tags.
  const allFiles = collectFiles(wsPath);
  const files = allFiles.filter(f => TAGS_EXTS.has(f.ext));
  const total = files.length;
  let processed = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;

    const batch = files.slice(i, i + BATCH_SIZE);

    // Process batch concurrently — parseTagsFromFile is I/O-bound (fs.promises.readFile)
    await Promise.all(batch.map(({ fullPath }) => _updateFile(fullPath)));
    processed += batch.length;

    // Report progress only for large workspaces (>500 files)
    if (total > 500) {
      onProgress?.(processed, total);
    }

    // Yield to the event loop so IPC and other callbacks remain responsive
    await new Promise(r => setImmediate(r));
  }

  const elapsed = Date.now() - startTime;
  console.log(`[tags-index] build complete: ${processed} files in ${elapsed}ms`);
  _emitter.emit('build-complete', { total: processed, elapsed });

  return { indexed: processed, elapsed };
}

/**
 * Attach tag-index listeners to an existing chokidar watcher.
 * Call inside watchWorkspace() alongside searchIncremental.start(watcher).
 * @param {import('chokidar').FSWatcher} watcher
 */
function start(watcher) {
  _watcher = watcher;
  watcher.on('add',    (fp) => _handleEvent('add',    fp));
  watcher.on('change', (fp) => _handleEvent('change', fp));
  watcher.on('unlink', (fp) => _handleEvent('unlink', fp));
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
 * Toggle build/live mode.
 * Call setReady(false) before buildIndex() to queue incoming events.
 * Call setReady(true) after buildIndex() resolves to replay queued events
 * and switch to live mode.
 * @param {boolean} ready
 */
function setReady(ready) {
  if (ready && !_ready) {
    _ready = true;
    if (_queue.size > 0) {
      console.log('[tags-index] replaying', _queue.size, 'queued events');
      for (const [filePath, event] of _queue) {
        if (event === 'unlink') {
          _removeFile(filePath);
        } else {
          _updateFile(filePath); // async, fire-and-forget during replay
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
 * Returns all tags with their file counts, sorted alphabetically.
 * Tag names are normalized (lowercase).
 * @returns {{ tag: string, count: number }[]}
 */
function getAllTags() {
  const result = [];
  for (const [tag, set] of _tagToFiles) {
    result.push({ tag, count: set.size });
  }
  return result.sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * Returns all file paths that carry the given tag (case-insensitive).
 * @param {string} tag
 * @returns {string[]}
 */
function getFilesByTag(tag) {
  const set = _tagToFiles.get(tag.toLowerCase());
  return set ? [...set] : [];
}

/**
 * Returns the tags for the given file path (original casing, as stored in file).
 * @param {string} filePath
 * @returns {string[]}
 */
function getTagsForFile(filePath) {
  return _fileToTags.get(filePath) || [];
}

/**
 * Returns a plain object mapping each file path to its tag array.
 * Only files that have at least one tag are included.
 * @returns {{ [filePath: string]: string[] }}
 */
function getAllFileTags() {
  const result = {};
  for (const [filePath, tags] of _fileToTags) {
    result[filePath] = tags;
  }
  return result;
}

/**
 * Force an immediate index update for the given file, bypassing the watcher
 * debounce. Call this after programmatically writing tags to a file so the
 * index reflects the change before the watcher fires.
 * Cancels any pending debounce timer for filePath to avoid a redundant re-parse.
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function refreshFile(filePath) {
  if (_timers.has(filePath)) {
    clearTimeout(_timers.get(filePath));
    _timers.delete(filePath);
  }
  await _updateFile(filePath);
}

/**
 * Subscribe to index events.
 * Events:
 *   'tags-changed'  { filePath, oldTags, newTags }  — emitted in live mode only
 *   'build-complete' { total, elapsed }              — emitted at end of buildIndex()
 * @param {string} event
 * @param {Function} handler
 */
function on(event, handler) {
  _emitter.on(event, handler);
}

module.exports = { init, buildIndex, start, stop, setReady, getAllTags, getFilesByTag, getTagsForFile, getAllFileTags, refreshFile, on };
