const CONFIG_FILE_NAME = 'nextprob.config.json';
// Offline snapshot of resources/settings/project-config.default.json.
// Refresh with scripts/sync-official-skills.js <content-repo>/skills.
const DEFAULT_CONFIG = require('../../bundled-skills/nextprob/assets/project-config.default.json');
function deepFreeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return value;
}
deepFreeze(DEFAULT_CONFIG);
module.exports = { CONFIG_FILE_NAME, DEFAULT_CONFIG };
