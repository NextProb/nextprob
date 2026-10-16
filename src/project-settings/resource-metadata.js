'use strict';

// Consumer adapters describe behavior; presentation definitions never invent it.
// Keep format-wide rendering separate from resource-specific runtime semantics.
const adapters = new Map([
  ['.syncignore', workspacePath => ({
    kind: 'ordered-ignore-rules',
    supportsExceptions: true,
    baselineRules: require('../sync/sync-ignore').getDefaultSyncignoreRules(workspacePath),
    baselineDescription: 'These rules apply before this file. Removing a matching line from the file does not remove its baseline rule. Later exceptions are evaluated in order.',
  })],
]);

function resourceMetadata(workspacePath, relativePath) {
  return adapters.get(relativePath)?.(workspacePath);
}

module.exports = { resourceMetadata };
