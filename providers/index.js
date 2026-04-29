'use strict';
const { generateSessionId } = require('../bridge');
const { getRemoteModels } = require('./remote-models');

const _providers = new Map();
let _activeName = 'openclaw';
let _activeModel = null;
let _activeEffort = null;
let _activePermissionMode = null;
let _remoteModelsLoaded = false;

function register(provider) {
  if (!provider || !provider.name) throw new Error('Provider must have a name');
  _providers.set(provider.name, provider);
}

function getProvider(name) {
  const p = _providers.get(name);
  if (!p) throw new Error(`Provider not found: ${name}`);
  return p;
}

function listProviders() {
  return Array.from(_providers.values()).map(({ name, label, type, supportsResume, models, supportsEffort, permissionModes, endpointConfig }) => {
    const remote = _remoteByProvider[name];
    const resolvedModels = remote?.models || models || [];
    const effortOptions = remote?.effort || null;
    return {
      name,
      label: label || name,
      type,
      supportsResume,
      models: resolvedModels,
      supportsEffort: effortOptions ? true : !!supportsEffort,
      effortOptions,
      defaultModel: remote?.defaultModel || null,
      defaultEffort: remote?.defaultEffort || null,
      permissionModes: remote?.permissionModes || permissionModes || [],
      endpointConfig: endpointConfig || null,
    };
  });
}

function unregisterByPrefix(prefix) {
  for (const name of _providers.keys()) {
    if (name.startsWith(prefix)) _providers.delete(name);
  }
}

function registerOpenAICompatEndpoints(endpoints) {
  unregisterByPrefix('openai-compat:');
  const { createOpenAICompatProvider } = require('./openai-compat');
  for (const endpoint of (endpoints || [])) {
    register(createOpenAICompatProvider(endpoint));
  }
}

function registerOpenClawRemoteEndpoints(endpoints) {
  unregisterByPrefix('openclaw-remote:');
  const { createOpenClawRemoteProvider } = require('./openclaw-remote');
  for (const endpoint of (endpoints || [])) {
    register(createOpenClawRemoteProvider(endpoint));
  }
}

// Remote config overrides, keyed by provider name
const _remoteByProvider = {};

/**
 * Fetch remote model definitions and cache them.
 * Call once at app startup (e.g. from main.js ready handler).
 * Non-blocking — silently falls back to hard-coded models on failure.
 */
async function refreshModels() {
  const remote = await getRemoteModels();
  if (!remote) return;
  for (const [providerName, config] of Object.entries(remote)) {
    if (!config || typeof config !== 'object') continue;
    // Support both new object format { models, effort, defaultModel, ... }
    // and legacy array format [ { id, label }, ... ]
    if (Array.isArray(config)) {
      _remoteByProvider[providerName] = { models: config };
    } else if (Array.isArray(config.models) && config.models.length > 0) {
      _remoteByProvider[providerName] = config;
    }
  }
  _remoteModelsLoaded = true;
}

function setActiveModel(modelId) {
  _activeModel = modelId || null;
}

function getActiveModel() {
  return _activeModel;
}

function setActiveEffort(effort) {
  _activeEffort = effort || null;
}

function getActiveEffort() {
  return _activeEffort;
}

function setActivePermissionMode(mode) { _activePermissionMode = mode; }
function getActivePermissionMode() { return _activePermissionMode; }

function activeProvider() {
  return getProvider(_activeName);
}

function setActiveProvider(name) {
  getProvider(name); // throws if not registered
  _activeName = name;
}

// Register built-in providers
// Note: claude-cli, codex-cli, and gemini-cli were removed from the chat dropdown
// because the same CLIs are available natively via the integrated terminal.
register(require('./openclaw'));

module.exports = {
  register,
  getProvider,
  listProviders,
  activeProvider,
  setActiveProvider,
  setActiveModel,
  getActiveModel,
  setActiveEffort,
  getActiveEffort,
  setActivePermissionMode,
  getActivePermissionMode,
  generateSessionId,
  refreshModels,
  unregisterByPrefix,
  registerOpenAICompatEndpoints,
  registerOpenClawRemoteEndpoints,
};
