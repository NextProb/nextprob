'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILENAME = '.built-in-seeded.json';

// ── State helpers ──────────────────────────────────────────────────────────────

function _readState(templatesPath) {
  const statePath = path.join(templatesPath, STATE_FILENAME);
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const obj = JSON.parse(raw);
    // Migrate old array format to versioned object format
    let seeded = {};
    if (Array.isArray(obj.seeded)) {
      for (const id of obj.seeded) seeded[id] = 0;
    } else if (obj.seeded && typeof obj.seeded === 'object') {
      seeded = obj.seeded;
    }
    const deleted = Array.isArray(obj.deleted) ? obj.deleted : [];
    return { seeded, deleted };
  } catch {
    return { seeded: {}, deleted: [] };
  }
}

function _writeState(templatesPath, state) {
  const statePath = path.join(templatesPath, STATE_FILENAME);
  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn('[built-in-templates] could not write state:', err.message);
  }
}

/**
 * Recursively copy srcDir to destDir, creating destDir if needed.
 * Overwrites existing files.
 */
function _copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      _copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Seed built-in templates from an extracted tarball into the workspace _templates/ dir.
 * @param {string} templatesPath  Absolute path to _templates/
 * @param {object} manifest       Manifest object: { id: { version } }
 * @param {string} sourceDir      Path to extracted templates directory from tarball
 * @returns {string[]} IDs that were written
 */
function seedBuiltInTemplates(templatesPath, manifest, sourceDir) {
  if (!manifest || !sourceDir) return [];

  const state = _readState(templatesPath);
  const written = [];

  for (const [id, info] of Object.entries(manifest)) {
    const version = info.version || 0;
    const src = path.join(sourceDir, id);
    const dest = path.join(templatesPath, id);

    // Skip if source doesn't exist in tarball
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;

    // Skip if user deleted this template
    if (state.deleted.includes(id)) continue;

    const seededVersion = state.seeded[id];

    if (seededVersion !== undefined) {
      // We previously seeded this template. Update only if remote is newer.
      if (version > seededVersion) {
        // Remove old folder and replace
        fs.rmSync(dest, { recursive: true, force: true });
        _copyDir(src, dest);
        state.seeded[id] = version;
        written.push(id);
      }
    } else {
      // Never seeded this ID before.
      // If folder already exists on disk (user's own folder with same name), skip.
      if (fs.existsSync(dest)) continue;
      _copyDir(src, dest);
      state.seeded[id] = version;
      written.push(id);
    }
  }

  if (written.length > 0) {
    _writeState(templatesPath, state);
    console.log('[built-in-templates] seeded:', written);
  }
  return written;
}

/**
 * Restore all built-in templates from an extracted tarball.
 * Clears the deleted list and re-writes all seeded templates.
 * Never overwrites user-created folders (those not in seeded list).
 * @param {string} templatesPath  Absolute path to _templates/
 * @param {object} manifest       Manifest object: { id: { version } }
 * @param {string} sourceDir      Path to extracted templates directory from tarball
 * @returns {string[]} IDs that were written
 */
function restoreBuiltInTemplates(templatesPath, manifest, sourceDir) {
  if (!manifest || !sourceDir) return [];

  const state = _readState(templatesPath);
  state.deleted = [];

  const written = [];
  for (const [id, info] of Object.entries(manifest)) {
    const version = info.version || 0;
    const src = path.join(sourceDir, id);
    const dest = path.join(templatesPath, id);

    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;

    if (state.seeded[id] !== undefined) {
      // We own this folder — always overwrite on restore
      fs.rmSync(dest, { recursive: true, force: true });
      _copyDir(src, dest);
      state.seeded[id] = version;
      written.push(id);
    } else {
      // Never seeded — could be user's own folder
      if (fs.existsSync(dest)) continue;
      _copyDir(src, dest);
      state.seeded[id] = version;
      written.push(id);
    }
  }

  _writeState(templatesPath, state);
  if (written.length > 0) {
    console.log('[built-in-templates] restored:', written);
  }
  return written;
}

/**
 * Attach a watcher unlinkDir handler to track user deletions of built-in templates.
 * @param {import('chokidar').FSWatcher} watcher
 * @param {string} templatesPath  Absolute path to _templates/
 * @param {string[]} builtInIds  IDs of known built-in templates
 */
function start(watcher, templatesPath, builtInIds) {
  const resolved = path.resolve(templatesPath);
  const idSet = new Set(builtInIds);
  watcher.on('unlinkDir', (dirPath) => {
    if (path.resolve(path.dirname(dirPath)) !== resolved) return;
    const id = path.basename(dirPath);
    if (!idSet.has(id)) return;
    const state = _readState(templatesPath);
    if (state.seeded[id] !== undefined && !state.deleted.includes(id)) {
      state.deleted.push(id);
      _writeState(templatesPath, state);
      console.log('[built-in-templates] marked as deleted:', id);
    }
  });
}

module.exports = { seedBuiltInTemplates, restoreBuiltInTemplates, start };
