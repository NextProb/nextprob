'use strict';

const path = require('path');
const fs = require('fs');
const { parseSearchQuery } = require('./search-query-parser');

// ─── Module-level state ───────────────────────────────────────────────────────

let _backend = null;       // 'sqlite' | 'lunr' | null
let _ready = false;
let _needsRebuildFlag = false;
let _currentWorkspacePath = null;

// SQLite state
let _db = null;
let _Database = null;

// lunr state
let _lunr = null;
let _lunrIndex = null;
let _lunrDocs = null;      // Map<path, { title: string, body: string, mtime: number }>
let _lunrDirty = true;
let _lunrStorePath = null;

// ─── Backend detection (runs once at require() time) ─────────────────────────

(function detectBackend() {
  try {
    _Database = require('better-sqlite3');
    _backend = 'sqlite';
  } catch (_e) {
    try {
      _lunr = require('lunr');
      _backend = 'lunr';
      console.log('[search-index] better-sqlite3 unavailable, using lunr.js fallback');
    } catch (_e2) {
      console.error('[search-index] No search backend available. Install better-sqlite3 or lunr.');
    }
  }
})();

// ─── SQLite helpers ───────────────────────────────────────────────────────────

function initSqlite(workspacePath) {
  const dbDir = path.join(workspacePath, '.notes-app');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, 'search.db');

  try {
    _db = new _Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        path UNINDEXED,
        title,
        body,
        tokenize='unicode61'
      );
      CREATE TABLE IF NOT EXISTS notes_meta (
        path TEXT PRIMARY KEY,
        mtime REAL,
        indexed_at TEXT
      );
    `);

    // If the metadata table is empty, a full rebuild is needed.
    const row = _db.prepare('SELECT COUNT(*) AS n FROM notes_meta').get();
    _needsRebuildFlag = row.n === 0;
    _ready = true;
  } catch (e) {
    console.warn('[search-index] Failed to open SQLite database:', e.message);
    if (_db) { try { _db.close(); } catch {} _db = null; }
    const isMalformed = /malformed|corrupt|not a database/i.test(e.message);
    if (isMalformed) {
      try { fs.unlinkSync(path.join(dbDir, 'search.db')); } catch {}
    }
    _needsRebuildFlag = true;
    _ready = false;
  }
}

function closeSqlite() {
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
  }
  _ready = false;
}

function addSqlite(filePath, title, body, mtime = 0) {
  // Check for existing row and delegate to update if found.
  const existing = _db.prepare('SELECT path FROM notes_meta WHERE path = ?').get(filePath);
  if (existing) {
    updateSqlite(filePath, title, body, mtime);
    return;
  }
  _db.prepare('INSERT INTO notes_fts(path, title, body) VALUES (?, ?, ?)').run(filePath, title, body);
  _db.prepare('INSERT INTO notes_meta(path, mtime, indexed_at) VALUES (?, ?, ?)').run(filePath, mtime, new Date().toISOString());
}

function updateSqlite(filePath, title, body, mtime = 0) {
  // FTS5 does not support UPDATE on content columns — delete + insert is the documented pattern.
  _db.prepare('DELETE FROM notes_fts WHERE path = ?').run(filePath);
  _db.prepare('INSERT INTO notes_fts(path, title, body) VALUES (?, ?, ?)').run(filePath, title, body);
  _db.prepare('UPDATE notes_meta SET mtime = ?, indexed_at = ? WHERE path = ?')
    .run(mtime, new Date().toISOString(), filePath);
}

function removeSqlite(filePath) {
  _db.prepare('DELETE FROM notes_fts WHERE path = ?').run(filePath);
  _db.prepare('DELETE FROM notes_meta WHERE path = ?').run(filePath);
}

function getIndexedMtimesSqlite() {
  const rows = _db.prepare('SELECT path, mtime FROM notes_meta').all();
  const map = new Map();
  for (const row of rows) map.set(row.path, row.mtime);
  return map;
}

function querySqlite(searchString) {
  const parsed = parseSearchQuery(searchString);

  // Determine whether we have any positive content to match
  const hasPositive = parsed.phrases.length > 0 || parsed.terms.length > 0;

  let rows;

  if (hasPositive) {
    // Build FTS5 MATCH expression
    // Phrases: pass through as FTS5 quoted phrases  e.g. "project plan"
    // Terms: wrap in quotes to prevent injection   e.g. "meeting"
    // Exclusions: NOT "word"
    const positiveParts = [
      ...parsed.phrases.map(p => `"${p.replace(/"/g, '')}"`),
      ...parsed.terms.map(t => `"${t.replace(/"/g, '')}"`),
    ];
    const exclusionParts = parsed.exclusions.map(e => `NOT "${e.replace(/"/g, '')}"`);
    const ftsExpr = [...positiveParts, ...exclusionParts].join(' ');

    if (!ftsExpr.trim()) return [];

    try {
      rows = _db.prepare(`
        SELECT
          path,
          title,
          snippet(notes_fts, 2, '<mark>', '</mark>', '…', 32) AS snippet,
          rank AS score
        FROM notes_fts
        WHERE notes_fts MATCH ?
        ORDER BY rank
        LIMIT 50
      `).all(ftsExpr);
    } catch (e) {
      console.warn('[search-index] SQLite query error:', e.message);
      return [];
    }
  } else if (parsed.exclusions.length > 0) {
    // Exclusion-only query: fetch all docs, post-filter in JS
    try {
      rows = _db.prepare(`
        SELECT path, title, '' AS snippet, 0 AS score
        FROM notes_fts
        LIMIT 200
      `).all();
      // Filter out rows whose body/title contains any excluded term
      const excLower = parsed.exclusions.map(e => e.toLowerCase());
      rows = rows.filter(r => {
        const haystack = ((r.title || '') + ' ' + (r.snippet || '')).toLowerCase();
        return excLower.every(ex => !haystack.includes(ex));
      });
    } catch (e) {
      console.warn('[search-index] SQLite query error (exclusion-only):', e.message);
      return [];
    }
  } else {
    return [];
  }

  // Apply type: post-filter on path extension
  if (parsed.types.length > 0) {
    rows = rows.filter(r => {
      const ext = r.path.split('.').pop().toLowerCase();
      return parsed.types.includes(ext);
    });
  }

  return rows.map(r => ({
    path: r.path,
    title: r.title,
    snippet: r.snippet,
    score: r.score,
  }));
}

// ─── lunr helpers ─────────────────────────────────────────────────────────────

function initLunr(workspacePath) {
  const dataDir = path.join(workspacePath, '.notes-app');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  _lunrStorePath = path.join(dataDir, 'search-index.json');
  _lunrDocs = new Map();

  if (fs.existsSync(_lunrStorePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(_lunrStorePath, 'utf8'));
      for (const [k, v] of Object.entries(raw)) {
        _lunrDocs.set(k, v);
      }
    } catch (e) {
      console.warn('[search-index] Failed to load lunr store, starting fresh:', e.message);
      _lunrDocs = new Map();
    }
  }

  _needsRebuildFlag = _lunrDocs.size === 0;
  _lunrIndex = null;
  _lunrDirty = true;   // Build index on first query.
  _ready = true;
}

function closeLunr() {
  saveLunrStore();
  _lunrIndex = null;
  _lunrDocs = null;
  _lunrStorePath = null;
  _lunrDirty = true;
  _ready = false;
}

function addLunr(filePath, title, body, mtime = 0) {
  _lunrDocs.set(filePath, { title: title || '', body: body || '', mtime: mtime || 0 });
  _lunrDirty = true;
  saveLunrStore();
}

function updateLunr(filePath, title, body, mtime = 0) {
  _lunrDocs.set(filePath, { title: title || '', body: body || '', mtime: mtime || 0 });
  _lunrDirty = true;
  saveLunrStore();
}

function removeLunr(filePath) {
  _lunrDocs.delete(filePath);
  _lunrDirty = true;
  saveLunrStore();
}

function getIndexedMtimesLunr() {
  const map = new Map();
  if (_lunrDocs) {
    _lunrDocs.forEach((doc, docPath) => map.set(docPath, doc.mtime || 0));
  }
  return map;
}

function queryLunr(searchString) {
  if (_lunrDirty) buildLunrIndex();
  if (!_lunrIndex) return [];

  const parsed = parseSearchQuery(searchString);

  // Build lunr query string
  // Phrases: lunr has no phrase search — require all individual words (+word)
  // Terms: +term (required)
  // Exclusions: -term (lunr native)
  const parts = [];
  for (const phrase of parsed.phrases) {
    for (const word of phrase.trim().split(/\s+/).filter(Boolean)) {
      parts.push(`+${word}`);
    }
  }
  for (const term of parsed.terms) {
    parts.push(`+${term}`);
  }
  for (const ex of parsed.exclusions) {
    parts.push(`-${ex}`);
  }

  let results;
  if (parts.length === 0 && parsed.exclusions.length > 0) {
    // Exclusion-only: iterate all known docs from _lunrDocs
    results = Array.from(_lunrDocs.keys()).map(ref => ({ ref, score: 1 }));
  } else if (parts.length === 0) {
    return [];
  } else {
    try {
      results = _lunrIndex.search(parts.join(' '));
    } catch (e) {
      console.warn('[search-index] lunr query error:', e.message);
      return [];
    }
  }

  // Apply type: post-filter
  if (parsed.types.length > 0) {
    results = results.filter(r => {
      const ext = r.ref.split('.').pop().toLowerCase();
      return parsed.types.includes(ext);
    });
  }

  // Exclusion-only: post-filter bodies
  if (parsed.terms.length === 0 && parsed.phrases.length === 0 && parsed.exclusions.length > 0) {
    const excLower = parsed.exclusions.map(e => e.toLowerCase());
    results = results.filter(r => {
      const doc = _lunrDocs.get(r.ref) || {};
      const haystack = ((doc.title || '') + ' ' + (doc.body || '')).toLowerCase();
      return excLower.every(ex => !haystack.includes(ex));
    });
  }

  // For snippet extraction, use positive terms + phrase words only
  const highlightTerms = [
    ...parsed.terms,
    ...parsed.phrases.flatMap(p => p.split(/\s+/).filter(Boolean)),
  ].join(' ');

  return results.slice(0, 50).map(r => {
    const doc = _lunrDocs.get(r.ref) || {};
    return {
      path: r.ref,
      title: doc.title || '',
      snippet: extractLunrSnippet(doc.body || '', highlightTerms || searchString),
      score: r.score,
    };
  });
}

function buildLunrIndex() {
  const docs = _lunrDocs;
  _lunrIndex = _lunr(function () {
    this.field('title', { boost: 10 });
    this.field('body');
    this.ref('path');
    docs.forEach((doc, docPath) => {
      this.add({ path: docPath, title: doc.title || '', body: doc.body || '' });
    });
  });
  _lunrDirty = false;
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Returns a ~160-character excerpt from body containing the first match for
 * any word in searchString. Falls back to the beginning of body.
 */
function extractLunrSnippet(body, searchString) {
  if (!body) return '';
  const words = searchString.trim().split(/\s+/).filter(Boolean);
  const lc = body.toLowerCase();
  let bestIdx = -1;
  for (const word of words) {
    const idx = lc.indexOf(word.toLowerCase());
    if (idx !== -1) { bestIdx = idx; break; }
  }
  if (bestIdx === -1) {
    return body.length > 160 ? body.slice(0, 160) + '…' : body;
  }
  const start = Math.max(0, bestIdx - 60);
  const end = Math.min(body.length, bestIdx + 100);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < body.length ? '…' : '';
  return prefix + body.slice(start, end) + suffix;
}

function saveLunrStore() {
  if (!_lunrStorePath || !_lunrDocs) return;
  try {
    const obj = {};
    _lunrDocs.forEach((doc, docPath) => { obj[docPath] = doc; });
    fs.writeFileSync(_lunrStorePath, JSON.stringify(obj), 'utf8');
  } catch (e) {
    console.warn('[search-index] Failed to save lunr store:', e.message);
  }
}

// ─── Dispatch helpers ─────────────────────────────────────────────────────────

function guardReady(method) {
  if (!_ready) throw new Error(`[search-index] ${method}() called before init()`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize (or re-initialize) the index for the given workspace.
 * Creates [workspace]/.notes-app/ if needed.
 * Calling init() while already initialized closes the previous connection first.
 *
 * @param {string} workspacePath - Absolute path to the workspace root.
 */
function init(workspacePath) {
  if (_ready && _currentWorkspacePath === workspacePath) return;
  if (_ready) close();
  _needsRebuildFlag = false;
  _currentWorkspacePath = workspacePath;

  if (_backend === 'sqlite') {
    initSqlite(workspacePath);
  } else if (_backend === 'lunr') {
    initLunr(workspacePath);
  }
}

/**
 * Close the database connection and free resources.
 * Safe to call multiple times. No-op if not initialized.
 */
function close() {
  if (_backend === 'sqlite') {
    closeSqlite();
  } else if (_backend === 'lunr') {
    closeLunr();
  }
  _currentWorkspacePath = null;
  _ready = false;
}

/**
 * Add a note to the index. If the path already exists, delegates to update().
 *
 * @param {string} filePath - Unique identifier (absolute path to the note file).
 * @param {string} title    - Extracted title (from <title> or first heading).
 * @param {string} body     - Plain-text content (HTML tags stripped by the caller).
 */
function add(filePath, title, body, mtime = 0) {
  guardReady('add');
  try {
    if (_backend === 'sqlite') addSqlite(filePath, title, body, mtime);
    else if (_backend === 'lunr') addLunr(filePath, title, body, mtime);
  } catch (e) {
    console.warn('[search-index] add() error:', e.message);
  }
}

/**
 * Update an existing note in the index. If the path does not exist, behaves
 * like add().
 *
 * @param {string} filePath - Unique identifier (absolute path to the note file).
 * @param {string} title    - New title.
 * @param {string} body     - New plain-text body.
 */
function update(filePath, title, body, mtime = 0) {
  guardReady('update');
  try {
    if (_backend === 'sqlite') {
      const exists = _db.prepare('SELECT path FROM notes_meta WHERE path = ?').get(filePath);
      if (!exists) addSqlite(filePath, title, body, mtime);
      else updateSqlite(filePath, title, body, mtime);
    } else if (_backend === 'lunr') {
      updateLunr(filePath, title, body, mtime);
    }
  } catch (e) {
    console.warn('[search-index] update() error:', e.message);
  }
}

/**
 * Remove a note from the index. No-op if the path is not indexed.
 *
 * @param {string} filePath - Unique identifier (absolute path to the note file).
 */
function remove(filePath) {
  guardReady('remove');
  try {
    if (_backend === 'sqlite') removeSqlite(filePath);
    else if (_backend === 'lunr') removeLunr(filePath);
  } catch (e) {
    console.warn('[search-index] remove() error:', e.message);
  }
}

/**
 * Search the index for notes matching searchString.
 * Returns an empty array for empty/whitespace-only queries.
 *
 * @param {string} searchString - The user's search query.
 * @returns {{ path: string, title: string, snippet: string, score: number }[]}
 *          Up to 50 results ordered by relevance (best first).
 */
function query(searchString) {
  if (!_ready) return [];
  if (!searchString || !searchString.trim()) return [];

  if (_backend === 'sqlite') return querySqlite(searchString);
  if (_backend === 'lunr') return queryLunr(searchString);
  return [];
}

/**
 * Returns true if init() has been called successfully and the index is usable.
 */
function isReady() {
  return _ready;
}

/**
 * Returns true if the index was newly created, is empty, or was corrupted.
 * Feature 80 (index builder) uses this to decide whether to do a full scan.
 */
function needsRebuild() {
  return _needsRebuildFlag;
}

/**
 * Returns a Map<filePath, mtime> of all currently indexed files and their
 * stored mtime values. Used by the builder to skip unchanged files.
 * Returns an empty Map if not initialized.
 */
function getIndexedMtimes() {
  if (!_ready) return new Map();
  try {
    if (_backend === 'sqlite') return getIndexedMtimesSqlite();
    if (_backend === 'lunr') return getIndexedMtimesLunr();
  } catch (e) {
    console.warn('[search-index] getIndexedMtimes() error:', e.message);
  }
  return new Map();
}

module.exports = { init, close, add, update, remove, query, isReady, needsRebuild, getIndexedMtimes };
