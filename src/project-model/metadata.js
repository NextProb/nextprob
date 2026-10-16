'use strict';

const fs = require('fs');
const path = require('path');
const { noteDbPath } = require('../notes/note-db');

const MAX_ARRAY_VALUES = 50;
const MAX_VALUE_LENGTH = 10000;

// Cache only projections: a large image or conversation is discarded after parsing.
// File signatures catch external edits; the projection contract catches config edits.
function createMetadataReader({ maxEntries = 2048, maxBytes = 16 * 1024 * 1024, readFile = fs.readFileSync } = {}) {
  const cache = new Map();
  let cachedBytes = 0;
  function invalidate(filename) {
    cachedBytes -= cache.get(filename)?.bytes || 0;
    cache.delete(filename);
  }
  function input(workspacePath, noteId) {
    const filename = noteDbPath(path.resolve(workspacePath), noteId);
    if (!filename) return { error: 'Invalid note storage path' };
    try {
      // Discovery excludes symlinks; also check the storage directory and file.
      if (fs.lstatSync(path.dirname(filename)).isSymbolicLink() || fs.lstatSync(filename).isSymbolicLink()
        || fs.realpathSync(filename) !== path.join(fs.realpathSync(workspacePath), noteId, 'storage', 'kv.json')) {
        invalidate(filename);
        return { filename, error: 'Symlinked note storage is not supported' };
      }
      const stat = fs.statSync(filename, { bigint: true });
      if (!stat.isFile()) return { filename, error: 'Note metadata must be a JSON object' };
      return { filename, signature: [stat.mtimeNs, stat.ctimeNs, stat.size, stat.ino].join(':') };
    } catch (error) {
      invalidate(filename);
      return { filename, missing: error.code === 'ENOENT' || error.code === 'ENOTDIR',
        ...(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? {} : { error: 'Cannot read note metadata' }) };
    }
  }
  function contract({ metadataFields = {}, includePublication = false }) {
    return JSON.stringify([includePublication, Object.entries(metadataFields).sort(([a], [b]) => a.localeCompare(b))
      .map(([id, field]) => [id, field.source, field.key, field.read, field.type])]);
  }
  function project(data, { metadataFields = {}, includePublication = false }, error) {
    return { metadata: projectMetadata(data, metadataFields),
      publication: includePublication ? publicationMetadata(data) : null, ...(error ? { error } : {}) };
  }
  function remember(source, key, result) {
    invalidate(source.filename);
    const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
    cache.set(source.filename, { signature: source.signature, contract: key, result, bytes });
    cachedBytes += bytes;
    while (cache.size > maxEntries || cachedBytes > maxBytes) invalidate(cache.keys().next().value);
  }
  function read(workspacePath, noteId, options = {}) {
    const source = input(workspacePath, noteId);
    if (source.error || source.missing) return project({}, options, source.error);
    const key = contract(options);
    const previous = cache.get(source.filename);
    if (previous?.signature === source.signature && previous.contract === key) {
      cache.delete(source.filename);
      cache.set(source.filename, previous);
      return structuredClone(previous.result);
    }
    let result;
    try {
      const data = JSON.parse(readFile(source.filename, 'utf8'));
      result = data && typeof data === 'object' && !Array.isArray(data)
        ? project(data, options) : project({}, options, 'Note metadata must be a JSON object');
    } catch { result = project({}, options, 'Cannot parse note metadata JSON'); }
    remember(source, key, result);
    return structuredClone(result);
  }
  // Called synchronously after a committed app write. Never retain the supplied KV object.
  function prime(workspacePath, noteId, data, options = {}) {
    const source = input(workspacePath, noteId);
    if (source.error || source.missing) return;
    // Date/toJSON, undefined, and non-finite inputs can differ from their committed
    // JSON representation. Fall back to one disk read for those uncommon cases.
    const keys = new Set(Object.values(options.metadataFields || {}).map(field => field.key));
    if (options.includePublication) for (const key of ['__shareId', '__shareUrl', '__shareVisibility']) keys.add(key);
    if (data && (typeof data.toJSON === 'function' || [...keys].some(key => {
      if (!Object.hasOwn(data, key)) return false;
      const value = data[key];
      return value === undefined || typeof value === 'function' || typeof value === 'symbol'
        || (typeof value === 'number' && !Number.isFinite(value))
        || (value && typeof value.toJSON === 'function')
        || (Array.isArray(value) && value.length <= MAX_ARRAY_VALUES && !Array.from(value).every(boundedScalar));
    }))) { invalidate(source.filename); return; }
    const result = data && typeof data === 'object' && !Array.isArray(data)
      ? project(data, options) : project({}, options, 'Note metadata must be a JSON object');
    remember(source, contract(options), result);
  }
  return { read, prime, invalidate, clear() { cache.clear(); cachedBytes = 0; } };
}

const defaultMetadataReader = createMetadataReader();
const ownValue = (data, key) => Object.hasOwn(data, key) ? data[key] : undefined;
const truthy = value => Boolean(value); // Existing publish-indicator semantics, including [] and {}.
function boundedScalar(value) {
  return value === null || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length <= MAX_VALUE_LENGTH);
}
function projectMetadata(data, definitions) {
  const metadata = {};
  for (const [id, definition] of Object.entries(definitions)) {
    const value = ownValue(data, definition.key);
    if (definition.read === 'exists') metadata[id] = Object.hasOwn(data, definition.key);
    else if (definition.read === 'truthy') metadata[id] = truthy(value);
    else if (definition.type === 'array') {
      metadata[id] = Array.isArray(value) && value.length <= MAX_ARRAY_VALUES && value.every(boundedScalar) ? [...value] : null;
    } else metadata[id] = typeof value === definition.type && boundedScalar(value) ? value : null;
  }
  return metadata;
}

function publicationMetadata(data) {
  const shareId = ownValue(data, '__shareId');
  if (!truthy(shareId)) return null;
  // Malformed objects still count as truthy, but must not retain arbitrary KV payloads.
  const shareUrl = ownValue(data, '__shareUrl');
  const visibility = ownValue(data, '__shareVisibility');
  return { shareId: boundedScalar(shareId) ? shareId : null,
    shareUrl: typeof shareUrl === 'string' && boundedScalar(shareUrl) ? shareUrl : null,
    visibility: typeof visibility === 'string' && visibility && boundedScalar(visibility) ? visibility : 'secret' };
}

module.exports = { createMetadataReader, defaultMetadataReader, projectMetadata, publicationMetadata };
