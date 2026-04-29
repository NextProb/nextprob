'use strict';

const path = require('path');
const fs = require('fs');

// ─── Module state ─────────────────────────────────────────────────────────────

let _favorites = [];
let _workspacePath = null;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _notesAppDir(workspacePath) {
  return path.join(workspacePath, '.notes-app');
}

function _favoritesFilePath(workspacePath) {
  return path.join(_notesAppDir(workspacePath), 'favorites.json');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read and parse .notes-app/favorites.json.
 * - Missing file → returns empty list (no log — normal first-use case).
 * - Empty or malformed JSON / missing `favorites` array → warns, backs up to
 *   favorites.json.bak (overwriting any previous backup), returns empty list.
 * @param {string} workspacePath
 * @returns {{ version: number, favorites: string[] }}
 */
function load(workspacePath) {
  const filePath = _favoritesFilePath(workspacePath);
  if (!fs.existsSync(filePath)) {
    return { version: 1, favorites: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) throw new Error('empty file');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.favorites)) throw new Error('missing favorites array');
    return { version: parsed.version || 1, favorites: parsed.favorites };
  } catch (err) {
    console.warn('[favorites] favorites.json is malformed, backing up and resetting:', err.message);
    try {
      fs.copyFileSync(filePath, filePath + '.bak');
    } catch (backupErr) {
      console.warn('[favorites] Failed to back up favorites.json:', backupErr.message);
    }
    return { version: 1, favorites: [] };
  }
}

/**
 * Persist favoritesArray to disk.
 * Creates .notes-app/ lazily on first call (lazy directory creation per spec).
 * @param {string} workspacePath
 * @param {string[]} favoritesArray  Array of relative paths.
 */
function save(workspacePath, favoritesArray) {
  const dir = _notesAppDir(workspacePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(
    _favoritesFilePath(workspacePath),
    JSON.stringify({ version: 1, favorites: favoritesArray }, null, 2)
  );
}

/**
 * Return a copy of the current in-memory favorites array (relative paths).
 * No disk I/O — reads from in-memory cache populated by init().
 * @returns {string[]}
 */
function list() {
  return [..._favorites];
}

/**
 * Append relPath to favorites if not already present, then persist.
 * Idempotent — calling twice with the same path does nothing on the second call.
 * @param {string} workspacePath
 * @param {string} relPath  Relative path from workspace root.
 * @returns {string[]} Updated favorites array.
 */
function add(workspacePath, relPath) {
  if (!_favorites.includes(relPath)) {
    _favorites.push(relPath);
    save(workspacePath, _favorites);
  }
  return [..._favorites];
}

/**
 * Remove relPath from favorites if present, then persist.
 * Idempotent — no error if relPath is absent.
 * @param {string} workspacePath
 * @param {string} relPath  Relative path from workspace root.
 * @returns {string[]} Updated favorites array.
 */
function remove(workspacePath, relPath) {
  const idx = _favorites.indexOf(relPath);
  if (idx !== -1) {
    _favorites.splice(idx, 1);
    save(workspacePath, _favorites);
  }
  return [..._favorites];
}

/**
 * Replace the favorites list with newArray, then persist.
 * @param {string} workspacePath
 * @param {string[]} newArray  New ordered array of relative paths.
 * @returns {string[]} Updated favorites array.
 */
function reorder(workspacePath, newArray) {
  _favorites = [...newArray];
  save(workspacePath, _favorites);
  return [..._favorites];
}

/**
 * Replace oldRelPath with newRelPath at the same index, preserving order.
 * If oldRelPath is not in the list, no-op.
 * @param {string} workspacePath
 * @param {string} oldRelPath
 * @param {string} newRelPath
 * @returns {string[]} Updated favorites array.
 */
function rename(workspacePath, oldRelPath, newRelPath) {
  const idx = _favorites.indexOf(oldRelPath);
  if (idx !== -1) {
    _favorites[idx] = newRelPath;
    save(workspacePath, _favorites);
  }
  return [..._favorites];
}

/**
 * Initialize the module for a workspace.
 * Loads favorites from disk into the in-memory cache.
 * Does NOT create .notes-app/ or favorites.json — lazy creation on first save().
 * @param {string} workspacePath
 */
function init(workspacePath) {
  _workspacePath = workspacePath;
  const data = load(workspacePath);
  _favorites = data.favorites;
}

/**
 * Clear in-memory state. Call before switching workspaces to avoid stale data.
 */
function reset() {
  _favorites = [];
  _workspacePath = null;
}

module.exports = { load, save, list, add, remove, rename, reorder, init, reset };
