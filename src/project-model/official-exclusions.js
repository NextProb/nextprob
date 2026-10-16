'use strict';

const fs = require('fs');
const path = require('path');

const RESOURCE_NAME = 'note-exclusions.json';
const BUNDLED_PATH = path.join(__dirname, '../project-settings', RESOURCE_NAME);

function validateOfficialExclusions(value) {
  if (!value || value.version !== 1 || Object.keys(value).some(key => !['version', 'hiddenFiles', 'hiddenFolders'].includes(key))
    || !Array.isArray(value.hiddenFiles) || !Array.isArray(value.hiddenFolders)) {
    throw new Error('Expected official exclusions version 1 with hiddenFiles and hiddenFolders arrays');
  }
  const diagnostics = require('../project-config/service').validateConfig({
    version: 1, surfaces: { sidebar: { sections: [{
      id: 'files', title: 'Files', view: 'tree', source: 'items',
      hiddenFiles: value.hiddenFiles, hiddenFolders: value.hiddenFolders,
    }] } },
  });
  if (diagnostics.length) throw new Error(`Invalid official exclusions: ${diagnostics.map(d => d.message).join('; ')}`);
  return value;
}

function readOfficialExclusions(catalogPath = path.join(__dirname, '../project-settings/catalog.json')) {
  const target = path.join(path.dirname(catalogPath), RESOURCE_NAME);
  let file = target;
  try { fs.lstatSync(target); }
  catch (error) { if (error.code !== 'ENOENT') throw error; file = BUNDLED_PATH; }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Invalid official exclusions resource');
  return validateOfficialExclusions(JSON.parse(fs.readFileSync(file, 'utf8')));
}

// The resource supplies evolving defaults, while each section stores additions
// and explicit removals. Keeping removals even after a default disappears means
// a later resource revision cannot undo a user's choice to show that entry.
function resolveSectionExclusions(section, defaults) {
  const resolved = {};
  for (const kind of ['Files', 'Folders']) {
    const hidden = `hidden${kind}`;
    const shown = new Set(section[`shown${kind}`] || []);
    resolved[hidden] = [...new Set([...(defaults?.[hidden] || []), ...(section[hidden] || [])])]
      .filter(value => !shown.has(value));
  }
  return resolved;
}

module.exports = { RESOURCE_NAME, validateOfficialExclusions, readOfficialExclusions, resolveSectionExclusions };
