'use strict';

const fs = require('fs');
const path = require('path');
const { installOfficialSkills } = require('./official-skills');
const { seedBuiltInTemplates } = require('./built-in-templates');
const { downloadContentFolders } = require('../providers/remote-content');

function installBundledSkills(workspacePath, options) {
  return installOfficialSkills(workspacePath, path.join(__dirname, '../../bundled-skills'), options);
}

// Each content family has its own manifest and installation policy, but they
// share a single download. A template failure must not prevent skill delivery.
async function syncWorkspaceContent(workspacePath, {
  templatesPath, appVersion, configVersion = 1,
  isCurrent = () => true, download = downloadContentFolders,
} = {}) {
  const content = await download();
  if (!content) return null;
  if (!isCurrent()) {
    fs.rmSync(content.tmpDir, { recursive: true, force: true });
    return null;
  }
  let skillsResult = null;
  if (content.skillsDir) {
    try { skillsResult = installOfficialSkills(workspacePath, content.skillsDir, { appVersion, configVersion }); }
    catch (error) { console.warn('[workspace-content] skills:', error.message); }
  }
  let manifest = null;
  let templatesWritten = [];
  if (content.templatesDir && templatesPath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(content.templatesDir, 'manifest.json'), 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || Object.entries(parsed).some(([id, info]) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
          || !info || !Number.isSafeInteger(info.version) || info.version < 1)) throw new Error('Invalid templates manifest');
      manifest = parsed;
      templatesWritten = seedBuiltInTemplates(templatesPath, manifest, content.templatesDir);
    } catch (error) { console.warn('[workspace-content] templates:', error.message); }
  }
  return { ...content, manifest, templatesWritten, skillsResult };
}

module.exports = { installBundledSkills, syncWorkspaceContent };
