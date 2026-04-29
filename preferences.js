const { app } = require("electron");
const path = require("path");
const fs = require("fs");

function prefsPath() {
  return path.join(app.getPath("userData"), "preferences.json");
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(prefsPath(), "utf-8"));
  } catch {
    return {};
  }
}

function save(prefs) {
  const filePath = prefsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(prefs, null, 2));
}

function getLastWorkspace() {
  return load().lastWorkspacePath || null;
}

function setLastWorkspace(wsPath) {
  const prefs = load();
  prefs.lastWorkspacePath = wsPath;
  save(prefs);
}

function getGitignoreTemplates() {
  return load().gitignoreTemplates ?? true;
}

function setGitignoreTemplates(value) {
  const p = load();
  p.gitignoreTemplates = value;
  save(p);
}

function getAuthor() {
  return load().author || "";
}

function setAuthor(name) {
  const prefs = load();
  prefs.author = name;
  save(prefs);
}

function getLastProvider() {
  return load().lastProvider || 'openclaw';
}

function setLastProvider(name) {
  const p = load();
  p.lastProvider = name;
  save(p);
}

function getLastModel() {
  return load().lastModel || {};
}

function setLastModel(provider, modelId) {
  const p = load();
  if (!p.lastModel) p.lastModel = {};
  p.lastModel[provider] = modelId;
  save(p);
}

function getLastEffort() {
  return load().lastEffort || {};
}

function setLastEffort(provider, effortId) {
  const p = load();
  if (!p.lastEffort) p.lastEffort = {};
  p.lastEffort[provider] = effortId;
  save(p);
}

function getLastPermissionMode() {
  return load().lastPermissionMode || {};
}

function setLastPermissionMode(provider, mode) {
  const p = load();
  if (!p.lastPermissionMode) p.lastPermissionMode = {};
  p.lastPermissionMode[provider] = mode;
  save(p);
}

function getUnsetApiKeys() {
  const defaults = { anthropic: true, openai: true, gemini: true };
  const stored = load().unsetApiKeys;
  if (!stored) return defaults;
  return { ...defaults, ...stored };
}

function setUnsetApiKeys(value) {
  const p = load();
  p.unsetApiKeys = value;
  save(p);
}

function getOpenaiCompatEndpoints() {
  return load().openaiCompatEndpoints || [];
}

function setOpenaiCompatEndpoints(endpoints) {
  const p = load();
  p.openaiCompatEndpoints = endpoints;
  save(p);
}

function getOpenclawRemoteEndpoints() {
  return load().openclawRemoteEndpoints || [];
}

function setOpenclawRemoteEndpoints(endpoints) {
  const p = load();
  p.openclawRemoteEndpoints = endpoints;
  save(p);
}

function getSshSyncEndpoints() {
  return load().sshSyncEndpoints || [];
}

function setSshSyncEndpoints(endpoints) {
  const p = load();
  p.sshSyncEndpoints = endpoints;
  save(p);
}

function getAwsSyncEnabled() {
  return load().awsSyncEnabled ?? false;
}

function setAwsSyncEnabled(value) {
  const p = load();
  p.awsSyncEnabled = value;
  save(p);
}

function getAwsSyncPaused() {
  return load().awsSyncPaused ?? false;
}

function setAwsSyncPaused(value) {
  const p = load();
  p.awsSyncPaused = !!value;
  save(p);
}

function getServerSyncPausedEndpoints() {
  return load().serverSyncPausedEndpoints || [];
}

function setServerSyncPausedEndpoints(ids) {
  const p = load();
  p.serverSyncPausedEndpoints = ids;
  save(p);
}

function getAwsSyncPromptShown() {
  return load().awsSyncPromptShown ?? false;
}

function setAwsSyncPromptShown(value) {
  const p = load();
  p.awsSyncPromptShown = value;
  save(p);
}

function getTheme() {
  return load().theme || null;
}

function setTheme(theme) {
  const p = load();
  p.theme = theme;
  save(p);
}

function getSidebarState(wsPath) {
  const all = load().sidebarState || {};
  return all[wsPath] || {};
}

function setSidebarStateKey(wsPath, key, value) {
  const p = load();
  if (!p.sidebarState) p.sidebarState = {};
  if (!p.sidebarState[wsPath]) p.sidebarState[wsPath] = {};
  p.sidebarState[wsPath][key] = value;
  save(p);
}

module.exports = { load, save, getLastWorkspace, setLastWorkspace, getGitignoreTemplates, setGitignoreTemplates, getAuthor, setAuthor, getLastProvider, setLastProvider, getLastModel, setLastModel, getLastEffort, setLastEffort, getLastPermissionMode, setLastPermissionMode, getUnsetApiKeys, setUnsetApiKeys, getOpenaiCompatEndpoints, setOpenaiCompatEndpoints, getAwsSyncEnabled, setAwsSyncEnabled, getAwsSyncPaused, setAwsSyncPaused, getServerSyncPausedEndpoints, setServerSyncPausedEndpoints, getAwsSyncPromptShown, setAwsSyncPromptShown, getOpenclawRemoteEndpoints, setOpenclawRemoteEndpoints, getSshSyncEndpoints, setSshSyncEndpoints, getTheme, setTheme, getSidebarState, setSidebarStateKey };
