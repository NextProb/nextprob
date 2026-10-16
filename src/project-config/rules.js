const jsonLogic = require('json-logic-js');
const FIELDS = new Set([
  'relativePath', 'kind', 'title', 'name', 'extension', 'ancestorPaths',
  'modifiedAt', 'favorite', 'favoriteOrder', 'capabilities',
  'capabilities.open', 'capabilities.createFromTemplate',
]);
const ARITIES = {
  '===': [2, 2], '!==': [2, 2], '==': [2, 2], '!=': [2, 2],
  '>': [2, 2], '>=': [2, 2], '<': [2, 3], '<=': [2, 3],
  and: [1, 50], or: [1, 50], '!': [1, 1], '!!': [1, 1],
  in: [2, 2], var: [1, 2],
};
function validateRule(rule, metadataFields = {}) {
  const metadata = require('./metadata-fields').metadataVariables(metadataFields);
  const diagnostics = [];
  let count = 0;
  function visit(node, location, depth) {
    if (++count > 256 || depth > 20) {
      if (!diagnostics.some(d => d.message === 'Rule exceeds complexity limits')) {
        diagnostics.push({ path: location, message: 'Rule exceeds complexity limits' });
      }
      return;
    }
    if (node === null || typeof node === 'string' || typeof node === 'boolean' || (typeof node === 'number' && Number.isFinite(node))) return;
    if (Array.isArray(node)) {
      if (node.length > 50) diagnostics.push({ path: location, message: 'Arrays may contain at most 50 values' });
      node.slice(0, 51).forEach((value, i) => visit(value, `${location}[${i}]`, depth + 1));
      return;
    }
    if (!node || typeof node !== 'object' || Object.keys(node).length !== 1) {
      diagnostics.push({ path: location, message: 'A rule must contain exactly one supported operator' });
      return;
    }
    const operator = Object.keys(node)[0];
    if (!Object.hasOwn(ARITIES, operator)) {
      diagnostics.push({ path: location, message: `Unsupported rule operator: ${operator}` });
      return;
    }
    const args = Array.isArray(node[operator]) ? node[operator] : [node[operator]];
    const [min, max] = ARITIES[operator];
    if (args.length < min || args.length > max) diagnostics.push({ path: location, message: `Invalid number of arguments for ${operator}` });
    if (operator === 'var') {
      if (typeof args[0] !== 'string' || (!FIELDS.has(args[0]) && !metadata.has(args[0]))) {
        diagnostics.push({ path: location, message: `Unsupported metadata field: ${String(args[0])}` });
      }
      if (args.length > 1) visit(args[1], `${location}.var[1]`, depth + 1);
    } else {
      args.slice(0, 51).forEach((value, i) => visit(value, `${location}.${operator}[${i}]`, depth + 1));
    }
  }
  visit(rule, '', 0);
  return diagnostics;
}
function compileRule(rule, metadataFields = {}) {
  if (validateRule(rule, metadataFields).length) return () => false;
  return item => {
    try { return Boolean(jsonLogic.truthy(jsonLogic.apply(rule, item))); } catch { return false; }
  };
}
function evaluateRule(rule, item, metadataFields = {}) { return compileRule(rule, metadataFields)(item); }
module.exports = { evaluateRule, compileRule, validateRule, FIELDS };
