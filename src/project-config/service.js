const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { CONFIG_FILE_NAME, DEFAULT_CONFIG } = require('./defaults');
const { validateRule } = require('./rules');
const { validMetadataId, RESERVED } = require('./metadata-fields');
const clone = value => JSON.parse(JSON.stringify(value));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);
const SOURCES = ['items', 'notes'];
const SORTS = ['title', 'name', 'path', 'modifiedAt', 'favoriteOrder'];
function normalizeConfig(raw) {
  return {
    version: 1,
    ...(raw.metadataFields !== undefined ? { metadataFields: clone(raw.metadataFields) } : {}),
    collections: { ...clone(DEFAULT_CONFIG.collections), ...clone(raw.collections || {}) },
    surfaces: {
      sidebar: { ...clone(DEFAULT_CONFIG.surfaces.sidebar), ...clone(raw.surfaces?.sidebar || {}) },
    },
  };
}
function validateConfig(raw) {
  const diagnostics = [];
  const fail = (location, message) => diagnostics.push({ path: location, message });
  function object(value, location, allowed) {
    if (!isObject(value)) { fail(location, 'Expected an object'); return false; }
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${location}${location ? '.' : ''}${key}`, 'Unknown configuration field');
    return true;
  }
  const source = (value, location) => { if (!SOURCES.includes(value)) fail(location, 'Source must be items or notes'); };
  const sort = (value, location) => { if (!SORTS.includes(value)) fail(location, `Sort must be one of: ${SORTS.join(', ')}`); };
  if (!object(raw, '', ['version', 'metadataFields', 'collections', 'surfaces'])) return diagnostics;
  if (raw.version !== 1) fail('version', 'Supported configuration version is 1');
  if (raw.metadataFields !== undefined) {
    if (!isObject(raw.metadataFields)) fail('metadataFields', 'Expected an object');
    else {
      if (Object.keys(raw.metadataFields).length > 100) fail('metadataFields', 'At most 100 metadata fields are supported');
      for (const [id, definition] of Object.entries(raw.metadataFields)) {
        const loc = `metadataFields.${id}`;
        if (!validMetadataId(id)) fail(loc, 'Invalid metadata field ID');
        if (!object(definition, loc, ['source', 'key', 'read', 'type'])) continue;
        if (definition.source !== 'noteKv') fail(`${loc}.source`, 'Metadata source must be noteKv');
        if (typeof definition.key !== 'string' || !definition.key.length || definition.key.length > 200 || definition.key.includes('\0') || RESERVED.has(definition.key)) fail(`${loc}.key`, 'Expected a literal KV key of 1–200 characters; reserved keys are forbidden');
        if (!['value', 'exists', 'truthy'].includes(definition.read)) fail(`${loc}.read`, 'Read mode must be value, exists, or truthy');
        if (definition.read === 'value') {
          if (!['string', 'number', 'boolean', 'array'].includes(definition.type)) fail(`${loc}.type`, 'Value fields require a string, number, boolean, or array type');
        } else if (definition.type !== undefined) fail(`${loc}.type`, 'Type is supported only for value fields');
      }
    }
  }
  if (raw.collections !== undefined) {
    if (!isObject(raw.collections)) fail('collections', 'Expected an object');
    else {
      if (Object.keys(raw.collections).length > 100) fail('collections', 'At most 100 collections are supported');
      for (const [id, collection] of Object.entries(raw.collections)) {
        const loc = `collections.${id}`;
        if (!validId(id)) fail(loc, 'Invalid collection ID');
        if (!object(collection, loc, ['source', 'where', 'sort'])) continue;
        source(collection.source, `${loc}.source`);
        if (collection.where !== undefined) for (const d of validateRule(collection.where, isObject(raw.metadataFields) ? raw.metadataFields : {})) fail(`${loc}.where${d.path ? `.${d.path}` : ''}`, d.message);
        if (collection.sort !== undefined) sort(collection.sort, `${loc}.sort`);
      }
    }
  }
  if (raw.surfaces !== undefined && object(raw.surfaces, 'surfaces', ['sidebar'])) {
    const sidebar = raw.surfaces.sidebar;
    if (sidebar !== undefined && object(sidebar, 'surfaces.sidebar', ['sections', 'hideDotFolders', 'hideOfficialFiles'])) {
      if (sidebar.hideDotFolders !== undefined && typeof sidebar.hideDotFolders !== 'boolean') fail('surfaces.sidebar.hideDotFolders', 'Expected a boolean');
      if (sidebar.hideOfficialFiles !== undefined && typeof sidebar.hideOfficialFiles !== 'boolean') fail('surfaces.sidebar.hideOfficialFiles', 'Expected a boolean');
      if (sidebar.sections !== undefined) {
        if (!Array.isArray(sidebar.sections)) fail('surfaces.sidebar.sections', 'Expected an array');
        else {
          if (sidebar.sections.length > 100) fail('surfaces.sidebar.sections', 'At most 100 sections are supported');
          const seen = new Set();
          sidebar.sections.forEach((section, index) => {
            const loc = `surfaces.sidebar.sections[${index}]`;
            if (!object(section, loc, ['id', 'title', 'view', 'source', 'collection', 'hiddenFolders', 'hiddenFiles', 'shownFolders', 'shownFiles', 'hideWhenEmpty', 'sort', 'enabled'])) return;
            if (!validId(section.id)) fail(`${loc}.id`, 'Invalid section ID');
            else if (seen.has(section.id)) fail(`${loc}.id`, 'Duplicate section ID');
            seen.add(section.id);
            if (typeof section.title !== 'string' || !section.title.trim() || section.title.length > 200) fail(`${loc}.title`, 'Title must be a nonempty string of at most 200 characters');
            if (!['list', 'tree'].includes(section.view)) fail(`${loc}.view`, 'View must be list or tree');
            if ((section.source !== undefined) === (section.collection !== undefined)) fail(loc, 'Specify exactly one source or collection');
            if (section.source !== undefined) source(section.source, `${loc}.source`);
            if (section.collection !== undefined && (!validId(section.collection) || !Object.hasOwn({ ...DEFAULT_CONFIG.collections, ...(isObject(raw.collections) ? raw.collections : {}) }, section.collection))) fail(`${loc}.collection`, 'Unknown collection');
            if (section.sort !== undefined) sort(section.sort, `${loc}.sort`);
            if (section.enabled !== undefined && typeof section.enabled !== 'boolean') fail(`${loc}.enabled`, 'Expected a boolean');
            if (section.hideWhenEmpty !== undefined && typeof section.hideWhenEmpty !== 'boolean') fail(`${loc}.hideWhenEmpty`, 'Expected a boolean');
            for (const field of ['hiddenFolders', 'hiddenFiles', 'shownFolders', 'shownFiles']) {
              if (section[field] === undefined) continue;
              if (section.view !== 'tree') fail(`${loc}.${field}`, `${field} is supported only for tree sections`);
              if (!Array.isArray(section[field]) || section[field].length > 1000) fail(`${loc}.${field}`, 'Expected at most 1000 paths');
              else section[field].forEach((value, i) => {
                if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.split('/').some(part => !part || part === '.' || part === '..') || /^[a-zA-Z]:/.test(value) || (field.endsWith('Files') && /[*?\[\]]/.test(value))) fail(`${loc}.${field}[${i}]`, field.endsWith('Files') ? 'Expected a filename or exact project-relative file path using /; wildcards are not supported' : 'Expected an exact project-relative directory path using /');
              });
            }
          });
        }
      }
    }
  }
  return diagnostics;
}
function createConfigService(workspacePath, { onChange } = {}) {
  const configPath = path.join(workspacePath, CONFIG_FILE_NAME);
  let snapshot = { config: clone(DEFAULT_CONFIG), diagnostics: [], exists: false };
  let watcher = null;
  function reload(notify = true) {
    let next;
    try {
      const stat = fs.statSync(configPath);
      if (stat.size > 1024 * 1024) throw new Error('Configuration file exceeds 1 MiB');
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const diagnostics = validateConfig(raw);
      next = { config: diagnostics.length ? snapshot.config : normalizeConfig(raw), diagnostics, exists: true };
    } catch (error) {
      next = error.code === 'ENOENT'
        ? { config: clone(DEFAULT_CONFIG), diagnostics: [], exists: false }
        : { config: snapshot.config, diagnostics: [{ path: '', message: error.message }], exists: true };
    }
    const changed = JSON.stringify(next) !== JSON.stringify(snapshot);
    snapshot = next;
    if (notify && changed && typeof onChange === 'function') onChange(clone(snapshot));
    return clone(snapshot);
  }
  reload(false);
  const service = {
    getSnapshot: () => clone(snapshot),
    reload,
    start() {
      if (!watcher) {
        watcher = chokidar.watch(configPath, { ignoreInitial: true, atomic: 150, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 } });
        watcher.on('add', () => reload()).on('change', () => reload()).on('unlink', () => reload());
        watcher.on('ready', () => reload());
        watcher.on('error', error => {
          snapshot = { ...snapshot, diagnostics: [{ path: '', message: `Configuration watcher: ${error.message}` }] };
          if (typeof onChange === 'function') onChange(clone(snapshot));
        });
      }
      return service;
    },
    async stop() {
      const oldWatcher = watcher;
      watcher = null;
      if (oldWatcher) await oldWatcher.close();
    },
  };
  return service;
}
module.exports = { createConfigService, validateConfig, normalizeConfig };
