'use strict';

const RESERVED = new Set(['constructor', 'prototype', '__proto__']);
const validMetadataId = value => typeof value === 'string'
  && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) && !RESERVED.has(value);

function metadataVariables(definitions = {}) {
  return new Set(Object.keys(definitions).filter(validMetadataId).map(id => `metadata.${id}`));
}

// Resolve dependencies from enabled sections, rather than loading every declared field.
function requiredMetadataFields(config, surface = 'sidebar') {
  const names = new Set();
  function visit(rule) {
    if (!rule || typeof rule !== 'object') return;
    if (Object.hasOwn(rule, 'var')) {
      const variable = Array.isArray(rule.var) ? rule.var[0] : rule.var;
      if (typeof variable === 'string' && variable.startsWith('metadata.')) names.add(variable.slice(9));
    }
    for (const value of Object.values(rule)) visit(value);
  }
  for (const section of config.surfaces?.[surface]?.sections || []) {
    if (section.enabled === false) continue;
    visit((section.collection ? config.collections?.[section.collection] : section)?.where);
  }
  return Object.fromEntries(Object.entries(config.metadataFields || {}).filter(([id]) => names.has(id)));
}

module.exports = { validMetadataId, metadataVariables, requiredMetadataFields, RESERVED };
