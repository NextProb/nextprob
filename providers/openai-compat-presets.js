'use strict';
const { fetchJSON } = require('./remote-models');

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const FALLBACK_PRESETS = [
  { id: 'ollama',    label: 'Ollama',    baseUrl: 'http://localhost:11434/v1', requiresKey: false, defaultModel: 'llama3',        models: ['llama3', 'codellama', 'mistral'] },
  { id: 'lmstudio',  label: 'LM Studio', baseUrl: 'http://localhost:1234/v1',  requiresKey: false, defaultModel: '',              models: [] },
  { id: 'llamacpp',  label: 'llama.cpp', baseUrl: 'http://localhost:8080/v1',  requiresKey: false, defaultModel: '',              models: [] },
  { id: 'vllm',      label: 'vLLM',      baseUrl: 'http://localhost:8000/v1',  requiresKey: false, defaultModel: '',              models: [] },
];

const { presetsJsonUrl: PRESETS_URL } = require('../content-urls');

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let _cachedPresets = null;
let _lastPresetFetch = 0;

async function getRemotePresets() {
  const now = Date.now();
  if (_cachedPresets && (now - _lastPresetFetch) < CACHE_TTL_MS) return _cachedPresets;

  const data = await fetchJSON(PRESETS_URL);
  if (Array.isArray(data) && data.length > 0) {
    _cachedPresets = data;
    _lastPresetFetch = now;
  }

  // Return cached data if available, else fall back to hardcoded
  return _cachedPresets || FALLBACK_PRESETS.map(p => ({ ...p }));
}

function mergePresetsWithEndpoints(presets, savedEndpoints) {
  // Build a set of presetIds already claimed by the user
  const userPresetIds = new Set(
    savedEndpoints.filter(e => e.presetId).map(e => e.presetId)
  );

  // New presets = presets not yet in the user's saved list
  const available = presets
    .filter(p => !userPresetIds.has(p.id))
    .map(p => ({
      id: uuidv4(),
      presetId: p.id,
      label: p.label,
      baseUrl: p.baseUrl,
      apiKey: '',
      modelId: p.defaultModel || '',
      userModified: false,
      requiresKey: p.requiresKey || false,
      models: p.models || [],
    }));

  // Active endpoints = all user-saved endpoints (user override always wins, even if presetId gone)
  const endpoints = savedEndpoints.slice();

  return { endpoints, available };
}

function resetEndpointToPreset(endpoint, presets) {
  const preset = presets.find(p => p.id === endpoint.presetId);
  if (!preset) return endpoint; // preset removed from remote; return unchanged

  return {
    ...endpoint,
    baseUrl: preset.baseUrl,
    modelId: preset.defaultModel || '',
    apiKey: '',           // always user-specific; cleared on reset
    userModified: false,  // re-enables future remote updates if merge logic changes
  };
}

module.exports = { FALLBACK_PRESETS, getRemotePresets, mergePresetsWithEndpoints, resetEndpointToPreset };
