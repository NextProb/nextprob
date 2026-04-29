'use strict';

// Resolves the remote-content URLs (models, presets, templates, workspace
// guide) from the active stage in auth-config.json. Per-URL env vars
// (MODELS_JSON_URL, PRESETS_JSON_URL, TEMPLATES_MANIFEST_URL,
// TEMPLATES_TARBALL_URL, CLAUDE_MD_URL) still override.
//
// Stage selection mirrors auth.js / sync-api.js: APP_STAGE env var, defaulting
// to 'dev'. main.js sets APP_STAGE='prod' for packaged builds.

const path = require('path');
const fs = require('fs');

const stage = process.env.APP_STAGE || 'dev';
const configPath = path.join(__dirname, 'auth-config.json');

let all;
try {
  all = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
  throw new Error(`content-urls: cannot read ${configPath} (${err.message}). Copy auth-config.example.json and fill in your values.`);
}

const cfg = all[stage];
if (!cfg) throw new Error(`content-urls: auth-config.json has no "${stage}" block.`);
if (!cfg.contentRepo) throw new Error(`content-urls: auth-config.json["${stage}"].contentRepo is missing.`);
if (!cfg.contentBranch) throw new Error(`content-urls: auth-config.json["${stage}"].contentBranch is missing.`);

const RAW = `https://raw.githubusercontent.com/${cfg.contentRepo}/${cfg.contentBranch}`;
const TARBALL = `https://api.github.com/repos/${cfg.contentRepo}/tarball/${cfg.contentBranch}`;

module.exports = {
  modelsJsonUrl: process.env.MODELS_JSON_URL || `${RAW}/models.json`,
  presetsJsonUrl: process.env.PRESETS_JSON_URL || `${RAW}/presets.json`,
  templatesManifestUrl: process.env.TEMPLATES_MANIFEST_URL || `${RAW}/templates/manifest.json`,
  templatesTarballUrl: process.env.TEMPLATES_TARBALL_URL || TARBALL,
  claudeMdUrl: process.env.CLAUDE_MD_URL || `${RAW}/workspace-claude.md`,
  shareRendererUrl: process.env.SHARE_RENDERER_URL || `${RAW}/share-renderer/index.html`,
  shareRobotsUrl: process.env.SHARE_ROBOTS_URL || `${RAW}/share-renderer/robots.txt`,
};
