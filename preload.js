const { contextBridge, ipcRenderer } = require("electron");

// Get the note-preload.js file:// URL from the main process via a synchronous IPC call.
// This avoids requiring Node built-ins (path, url) which are unavailable in sandboxed
// preload scripts. ipcRenderer.sendSync is safe here — it runs once during preload
// before any UI has rendered.
const _notePreloadUrl = ipcRenderer.sendSync('get-note-preload-url');
const _noteCss = ipcRenderer.sendSync('get-note-css');

// Apply theme before first paint to prevent flash of wrong theme.
// ipcRenderer.sendSync blocks until main process returns "dark" or "light".
const _theme = ipcRenderer.sendSync('theme:get');
if (_theme === 'light') {
  if (document.documentElement) {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.setAttribute('data-theme', 'light');
    }, { once: true });
  }
}
// Dark is the default (no attribute needed); never set data-theme="dark".

contextBridge.exposeInMainWorld("api", {
  // App root path and preload URL — used by renderer for the webview preload
  appDir: null,
  notePreloadUrl: _notePreloadUrl,
  noteCss: _noteCss,
  // Workspace
  openWorkspaceInFinder: () => ipcRenderer.invoke("workspace:openInFinder"),
  listNotes: () => ipcRenderer.invoke("workspace:list"),
  readNote: (filePath) => ipcRenderer.invoke("workspace:read", filePath),
  readBinary: (filePath) => ipcRenderer.invoke("workspace:readBinary", filePath),
  getWorkspacePath: () => ipcRenderer.invoke("workspace:path"),

  // File operations
  renameItem: (oldPath, newPath) => ipcRenderer.invoke("fs:rename", oldPath, newPath),
  trashItem: (itemPath) => ipcRenderer.invoke("fs:trash", itemPath),
  createFile: (filePath) => ipcRenderer.invoke("fs:createFile", filePath),
  createFileWithContent: (filePath, content) => ipcRenderer.invoke("fs:createFileWithContent", filePath, content),
  createFolder: (dirPath) => ipcRenderer.invoke("fs:createFolder", dirPath),
  createNote: (folderPath, content) => ipcRenderer.invoke("fs:createNote", folderPath, content),
  createNoteFromTemplate: (destPath, templatePath) => ipcRenderer.invoke("fs:createNoteFromTemplate", destPath, templatePath),
  pathExists: (filePath) => ipcRenderer.invoke("fs:pathExists", filePath),
  duplicateNote: (folderPath) => ipcRenderer.invoke("fs:duplicateNote", folderPath),

  // Project
  createProject: (opts) => ipcRenderer.invoke("project:create", opts),
  openProject: () => ipcRenderer.invoke("project:open"),
  confirmOpen: (opts) => ipcRenderer.invoke("project:confirmOpen", opts),
  changeWorkspace: () => ipcRenderer.invoke("project:changeWorkspace"),
  browseDirectory: () => ipcRenderer.invoke("project:browseDirectory"),
  getDefaultProjectDir: () => ipcRenderer.invoke("project:defaultDir"),
  cloneProject: (opts) => ipcRenderer.invoke('project:clone', opts),
  checkTargetDir: (targetPath) => ipcRenderer.invoke('project:checkTargetDir', targetPath),

  // Temp images
  saveTempImage: (filename, base64Data) =>
    ipcRenderer.invoke("fs:saveTempImage", filename, base64Data),
  cleanupTempImages: () => ipcRenderer.invoke("fs:cleanupTempImages"),

  // File picker
  browseFiles: () => ipcRenderer.invoke("dialog:browseFiles"),
  readFilePreview: (filePath) => ipcRenderer.invoke("fs:readFilePreview", filePath),

  // Claude
  sendToClaude: (prompt, messages) => ipcRenderer.invoke("claude:send", prompt, messages),
  cancelClaude: () => ipcRenderer.invoke("claude:cancel"),
  // Feature 100: test-only — retrieve the last augmented prompt sent to Claude
  getClaudeLastPrompt: () => ipcRenderer.invoke('claude:getLastPrompt'),
  newConversation: () => ipcRenderer.invoke("claude:newConversation"),

  // Conversations
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  loadConversation: (id) => ipcRenderer.invoke('conversations:load', id),
  saveConversation: (conv) => ipcRenderer.invoke('conversations:save', conv),
  deleteConversation: (id) => ipcRenderer.invoke('conversations:delete', id),
  updateConversationTitle: (id, title) => ipcRenderer.invoke('conversations:updateTitle', id, title),
  resumeConversation: (sessionId, msgCount) => ipcRenderer.invoke('claude:resumeConversation', sessionId, msgCount),

  // Providers
  listProviders: () => ipcRenderer.invoke('providers:list'),
  setActiveProvider: (name) => ipcRenderer.invoke('providers:setActive', name),
  getLastProvider: () => ipcRenderer.invoke('preferences:getLastProvider'),
  setLastProvider: (name) => ipcRenderer.invoke('preferences:setLastProvider', name),
  // Model selection (feature 134)
  getLastModel: () => ipcRenderer.invoke('preferences:getLastModel'),
  setLastModel: (provider, modelId) => ipcRenderer.invoke('preferences:setLastModel', provider, modelId),
  setActiveModel: (modelId) => ipcRenderer.invoke('providers:setActiveModel', modelId),

  // Effort selection (feature 135)
  getLastEffort: () => ipcRenderer.invoke('preferences:getLastEffort'),
  setLastEffort: (provider, effortId) => ipcRenderer.invoke('preferences:setLastEffort', provider, effortId),
  setActiveEffort: (effortId) => ipcRenderer.invoke('providers:setActiveEffort', effortId),

  // Permission mode selection (feature 136)
  getLastPermissionMode: () => ipcRenderer.invoke('preferences:getLastPermissionMode'),
  setLastPermissionMode: (provider, mode) => ipcRenderer.invoke('preferences:setLastPermissionMode', provider, mode),
  setActivePermissionMode: (mode) => ipcRenderer.invoke('providers:setActivePermissionMode', mode),

  // Sidebar state (per-workspace collapse states)
  getSidebarState: (wsPath) => ipcRenderer.invoke('preferences:getSidebarState', wsPath),
  setSidebarStateKey: (wsPath, key, value) => ipcRenderer.invoke('preferences:setSidebarStateKey', wsPath, key, value),

  // Debug logging (dev only — writes to debug-sidebar.log in project root)
  debugLog: (msg) => ipcRenderer.invoke('debug:log', msg),

  // Window
  closeWindow: () => ipcRenderer.invoke('window:close'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),

  // Terminal
  toggleTerminal: () => ipcRenderer.invoke('terminal:toggle'),
  isTerminalVisible: () => ipcRenderer.invoke('terminal:isVisible'),
  onTerminalVisibilityChanged: (cb) => ipcRenderer.on('terminal:visibilityChanged', (_e, visible, height) => cb(visible, height)),
  sendTerminalPanelBounds: (bounds) => ipcRenderer.send('terminal:panelBounds', bounds),

  // Theme (feature 153)
  getTheme: () => ipcRenderer.invoke('theme:getCurrent'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),

  // Sync
  getSyncStatus: () => ipcRenderer.invoke('sync:getStatus'),
  getSyncState: () => ipcRenderer.invoke('sync:getState'),
  onSyncStatusChanged: (cb) => ipcRenderer.on('sync:statusChanged', (_e, data) => cb(data)),
  trySyncTransition: (nextState) => ipcRenderer.invoke('sync:tryTransition', nextState),
  ensureGitignore: () => ipcRenderer.invoke('sync:ensureGitignore'),
  checkAuth: (remoteUrl) => ipcRenderer.invoke('sync:checkAuth', remoteUrl),
  initRepo: () => ipcRenderer.invoke('sync:initRepo'),
  addRemote: (url) => ipcRenderer.invoke('sync:addRemote', url),
  initialCommitAndPush: () => ipcRenderer.invoke('sync:initialCommitAndPush'),
  reinitializeSync: () => ipcRenderer.invoke('sync:reinitialize'),
  pullNow: () => ipcRenderer.invoke('sync:pullNow'),
  pushNow: () => ipcRenderer.invoke('sync:pushNow'),
  getLastSyncTimestamps: () => ipcRenderer.invoke('sync:getLastSyncTimestamps'),
  syncNow: () => ipcRenderer.invoke('sync:syncNow'),
  getConflicts: () => ipcRenderer.invoke('sync:getConflicts'),
  resolveConflict: (filePath, chosenContent) => ipcRenderer.invoke('sync:resolveConflict', filePath, chosenContent),
  finalizeMerge: () => ipcRenderer.invoke('sync:finalizeMerge'),
  abortMerge: () => ipcRenderer.invoke('sync:abortMerge'),
  getActivityLog: () => ipcRenderer.invoke('sync:getActivityLog'),
  checkHealth: () => ipcRenderer.invoke('sync:checkHealth'),
  recoverLockedIndex: () => ipcRenderer.invoke('sync:recoverLockedIndex'),
  recoverInterruptedRebase: () => ipcRenderer.invoke('sync:recoverInterruptedRebase'),
  recoverInterruptedMerge: () => ipcRenderer.invoke('sync:recoverInterruptedMerge'),
  recoverDetachedHead: (branch) => ipcRenderer.invoke('sync:recoverDetachedHead', branch),
  recoverReclone: () => ipcRenderer.invoke('sync:recoverReclone'),
  listBranches: () => ipcRenderer.invoke('sync:listBranches'),
  pauseSync: () => ipcRenderer.invoke('sync:pauseSync'),
  resumeSync: () => ipcRenderer.invoke('sync:resumeSync'),
  disconnectSync: () => ipcRenderer.invoke('sync:disconnectSync'),
  isSyncPaused: () => ipcRenderer.invoke('sync:isPaused'),
  getSyncSettings: () => ipcRenderer.invoke('sync:getSyncSettings'),
  setSyncSettings: (settings) => ipcRenderer.invoke('sync:setSyncSettings', settings),

  // Events from main
  onWorkspaceLoaded: (cb) => {
    ipcRenderer.on("workspace:loaded", (_e, data) => cb(data));
  },
  onNotesUpdated: (cb) => {
    ipcRenderer.on("notes:updated", (_e, tree) => cb(tree));
  },
  onNoteContentChanged: (cb) => {
    ipcRenderer.on("note:contentChanged", (_e, absPath) => cb(absPath));
  },
  onClaudeEvent: (cb) => {
    ipcRenderer.on("claude:event", (_e, event) => cb(event));
  },
  onClaudeError: (cb) => {
    ipcRenderer.on("claude:error", (_e, chunk) => cb(chunk));
  },
  onClaudeDone: (cb) => {
    ipcRenderer.on("claude:done", (_e, code) => cb(code));
  },
  onClaudeSessionId: (cb) => {
    ipcRenderer.on('claude:sessionId', (_e, id) => cb(id));
  },
  onOpenSyncSetup: (cb) => {
    ipcRenderer.on('sync:openSetup', () => cb());
  },

  // SEARCH DISABLED — Search index progress events (feature 80)
  // onSearchIndexProgress: (cb) => ipcRenderer.on('search:indexProgress', (_e, data) => cb(data)),
  // onSearchIndexComplete: (cb) => ipcRenderer.on('search:indexComplete', (_e, data) => cb(data)),
  // onSearchIndexError: (cb) => ipcRenderer.on('search:indexError', (_e, data) => cb(data)),
  // TAGS DISABLED — onTagsChanged (feature 98)
  // onTagsChanged: (cb) => ipcRenderer.on('tags:changed', (_event, changes) => cb(changes)),
  // Model list refreshed after remote fetch
  onModelsRefreshed: (cb) => ipcRenderer.on('models:refreshed', () => cb()),
  onScriptsRunChanged: (cb) => ipcRenderer.on('scripts:runChanged', () => cb()),
  onScriptsMissingModule: (cb) => ipcRenderer.on('scripts:missingModule', (_e, data) => cb(data)),
  // Templates error (feature 111)
  onTemplatesError: (cb) => ipcRenderer.on('templates:error', (_e, msg) => cb(msg)),
  // Templates registry (feature 112)
  templatesList: () => ipcRenderer.invoke('templates:list'),
  onTemplatesUpdated: (cb) => ipcRenderer.on('templates:updated', (_e, templates) => cb(templates)),
  // Templates restore (feature 115)
  templatesRestoreDefaults: () => ipcRenderer.invoke('templates:restoreDefaults'),
  onTemplatesRestoreComplete: (cb) => ipcRenderer.on('templates:restoreComplete', (_e, data) => cb(data)),
  // Templates save as template (feature 116)
  templatesSaveAsTemplate: (sourcePath, templateName) => ipcRenderer.invoke('templates:saveAsTemplate', sourcePath, templateName),

  // Preferences (feature 114)
  preferencesGetAuthor: () => ipcRenderer.invoke('preferences:getAuthor'),

  // SEARCH DISABLED — Search query (feature 82)
  // searchQuery: (query) => ipcRenderer.invoke('search:query', query),

  // TAGS DISABLED — Tags (feature 90)
  // tagsList: () => ipcRenderer.invoke('tags:list'),
  // tagsFiles: (tag) => ipcRenderer.invoke('tags:files', tag),
  // tagsAdd: (filePath, tagNames) => ipcRenderer.invoke('tags:add', filePath, tagNames),
  // tagsRemove: (filePath, tagNames) => ipcRenderer.invoke('tags:remove', filePath, tagNames),
  // tagsAllFileTags: () => ipcRenderer.invoke('tags:all-file-tags'),

  // Export (feature 102)
  exportNote: (filePath, format, options) => ipcRenderer.invoke('export:note', filePath, format, options),
  exportFormats: () => ipcRenderer.invoke('export:formats'),

  // PDF export with Save dialog (feature 103)
  exportSavePdf: (filePath, options) => ipcRenderer.invoke('export:save-pdf', filePath, options),
  onPdfProgress: (callback) => ipcRenderer.on('export:pdf-progress', (_e, status) => callback(status)),

  // Markdown export with Save dialog (feature 104)
  exportSaveMarkdown: (filePath) => ipcRenderer.invoke('export:save-markdown', filePath),

  // Plain text export with Save dialog (feature 105)
  exportSavePlaintext: (filePath) => ipcRenderer.invoke('export:save-plaintext', filePath),

  // HTML copy export with Save dialog (feature 110)
  exportSaveHtml: (filePath) => ipcRenderer.invoke('export:save-html', filePath),

  // Bulk export to ZIP (feature 106)
  exportBulk: (folderPath, format) => ipcRenderer.invoke('export:bulk', folderPath, format),
  onBulkExportProgress: (callback) => ipcRenderer.on('export:bulk-progress', (_e, data) => callback(data)),
  exportBulkCancel: () => ipcRenderer.send('export:bulk-cancel'),

  // Export as single HTML file
  exportSingleHtml: (noteRelPath) => ipcRenderer.invoke('export:single-html', noteRelPath),

  // Publish / unpublish as shareable link
  publishNote: (noteRelPath, options) => ipcRenderer.invoke('export:publish', noteRelPath, options),
  unpublishNote: (noteRelPath) => ipcRenderer.invoke('export:unpublish', noteRelPath),
  listPublishedNotes: () => ipcRenderer.invoke('notes:listPublished'),

  // Export as standalone Electron app
  exportStandalone: (noteRelPath) => ipcRenderer.invoke('export:standalone', noteRelPath),
  onStandaloneProgress: (callback) => ipcRenderer.on('export:standalone-progress', (_e, stage) => callback(stage)),
  exportStandaloneSource: (noteRelPath) => ipcRenderer.invoke('export:standalone-source', noteRelPath),

  // Markdown import (feature 107)
  browseMarkdownFiles: () => ipcRenderer.invoke('import:browse-markdown'),
  importMarkdown: (filePaths, targetDir, mode) => ipcRenderer.invoke('import:markdown', filePaths, targetDir, mode),

  // Plain text import (feature 108)
  browsePlaintextFiles: () => ipcRenderer.invoke('import:browse-plaintext'),
  importPlaintext: (filePaths, targetDir, mode) => ipcRenderer.invoke('import:plaintext', filePaths, targetDir, mode),

  // Batch import (feature 109)
  batchScanFolder: (folderPath) => ipcRenderer.invoke('import:batch-scan-folder', folderPath),
  batchScanFiles: (filePaths) => ipcRenderer.invoke('import:batch-scan-files', filePaths),
  batchBrowseFolder: () => ipcRenderer.invoke('import:batch-browse-folder'),
  batchImportExecute: (files, targetDir) => ipcRenderer.invoke('import:batch-execute', files, targetDir),
  onBatchImportProgress: (callback) => ipcRenderer.on('import:batch-progress', (_e, data) => callback(data)),
  batchImportCancel: () => ipcRenderer.send('import:batch-cancel'),

  // Web clip
  clipFromUrl: (url, targetDir) => ipcRenderer.invoke('clip:from-url', url, targetDir),

  // Favorites (feature 119)
  favoritesList: () => ipcRenderer.invoke('favorites:list'),
  favoritesAdd: (relPath) => ipcRenderer.invoke('favorites:add', relPath),
  favoritesRemove: (relPath) => ipcRenderer.invoke('favorites:remove', relPath),
  favoritesReorder: (newArray) => ipcRenderer.invoke('favorites:reorder', newArray),
  onFavoritesChanged: (cb) => ipcRenderer.on('favorites:changed', (_e, list) => cb(list)),
  favoritesRename: (oldRelPath, newRelPath) => ipcRenderer.invoke('favorites:rename', oldRelPath, newRelPath),

  // Internal link navigation — open external URLs in system browser (feature 125)
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // BACKLINKS/GRAPH DISABLED
  // getBacklinks: (filePath) => ipcRenderer.invoke('backlinks:get', filePath),
  // onBacklinksChanged: (cb) => ipcRenderer.on('backlinks:changed', (_event, relPaths) => cb(relPaths)),
  //
  // // Graph view (feature 127)
  // getGraphData: () => ipcRenderer.invoke('graph:getData'),
  // onGraphOpen: (cb) => ipcRenderer.on('graph:open', () => cb()),

  // Unset API keys preference (feature 145)
  getUnsetApiKeys: () => ipcRenderer.invoke('preferences:getUnsetApiKeys'),
  setUnsetApiKeys: (value) => ipcRenderer.invoke('preferences:setUnsetApiKeys', value),

  // OpenAI-compatible endpoints (feature 128)
  getOpenaiCompatEndpoints: () => ipcRenderer.invoke('openai-compat:getEndpoints'),
  setOpenaiCompatEndpoints: (endpoints) => ipcRenderer.invoke('openai-compat:setEndpoints', endpoints),
  fetchOpenaiCompatModels: (baseUrl, apiKey) => ipcRenderer.invoke('openai-compat:fetchModels', baseUrl, apiKey),
  onProvidersUpdated: (cb) => ipcRenderer.on('providers:updated', () => cb()),

  // OpenAI-compatible presets (feature 129)
  getOpenaiCompatAvailablePresets: () => ipcRenderer.invoke('openai-compat:getAvailablePresets'),
  getAllOpenaiCompatPresets: () => ipcRenderer.invoke('openai-compat:getPresets'),
  resetOpenaiCompatEndpoint: (endpointId) => ipcRenderer.invoke('openai-compat:resetEndpoint', endpointId),

  // OpenClaw remote endpoints (feature 150)
  getOpenclawRemoteEndpoints: () => ipcRenderer.invoke('openclaw-remote:getEndpoints'),
  setOpenclawRemoteEndpoints: (endpoints) => ipcRenderer.invoke('openclaw-remote:setEndpoints', endpoints),

  // OpenClaw remote endpoints — granular operations (feature 151)
  addOpenclawRemoteEndpoint: (endpoint) => ipcRenderer.invoke('openclaw-remote:add', endpoint),
  removeOpenclawRemoteEndpoint: (endpointId) => ipcRenderer.invoke('openclaw-remote:remove', endpointId),
  testOpenclawRemoteEndpoint: (endpoint) => ipcRenderer.invoke('openclaw-remote:test', endpoint),

  // Auth (feature 141)
  authLogin: () => ipcRenderer.invoke('auth:login'),
  authSignup: () => ipcRenderer.invoke('auth:signup'),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authGetUser: () => ipcRenderer.invoke('auth:getUser'),
  authIsLoggedIn: () => ipcRenderer.invoke('auth:isLoggedIn'),
  authGetAccessToken: () => ipcRenderer.invoke('auth:getAccessToken'),
  authIsEncryptionUnavailable: () => ipcRenderer.invoke('auth:isEncryptionUnavailable'),
  onAuthStateChanged: (cb) => ipcRenderer.on('auth:stateChanged', (_e, user) => cb(user)),

  // GitHub (gist-backed sharing)
  githubConnect: () => ipcRenderer.invoke('github:connect'),
  githubCancelConnect: () => ipcRenderer.invoke('github:cancelConnect'),
  githubDisconnect: () => ipcRenderer.invoke('github:disconnect'),
  githubGetState: () => ipcRenderer.invoke('github:getState'),
  githubSetRepoName: (name) => ipcRenderer.invoke('github:setRepoName', name),
  githubCheckRepoName: (name) => ipcRenderer.invoke('github:checkRepoName', name),
  githubProvisionRepo: () => ipcRenderer.invoke('github:provisionRepo'),
  onGithubStateChanged: (cb) => ipcRenderer.on('github:stateChanged', (_e, state) => cb(state)),

  // AWS Content Sync (feature 143)
  awsSyncGetContentStatus: () => ipcRenderer.invoke('aws-sync:getContentStatus'),
  awsSyncContentNow: () => ipcRenderer.invoke('aws-sync:syncContentNow'),
  awsSyncGetConflicts: () => ipcRenderer.invoke('aws-sync:getConflicts'),
  awsSyncGetConflictDetails: (conflictRelPath) => ipcRenderer.invoke('aws-sync:getConflictDetails', conflictRelPath),
  awsSyncResolveConflict: (filePath, choice) => ipcRenderer.invoke('aws-sync:resolveConflict', filePath, choice),
  onAwsSyncContentStatus: (cb) => ipcRenderer.on('aws-sync:contentStatusChanged', (_e, data) => cb(data)),

  // AWS KV Sync (feature 144)
  awsSyncGetKvStatus: () => ipcRenderer.invoke('aws-sync:getKvStatus'),
  awsSyncKvNow: () => ipcRenderer.invoke('aws-sync:syncKvNow'),

  // AWS Files Sync (feature 145)
  awsSyncGetFilesStatus: () => ipcRenderer.invoke('aws-sync:getFilesStatus'),
  awsSyncFilesNow: () => ipcRenderer.invoke('aws-sync:syncFilesNow'),

  // AWS Sync unified API (feature 146)
  awsSyncGetStatus: () => ipcRenderer.invoke('aws-sync:getStatus'),
  awsSyncNow: () => ipcRenderer.invoke('aws-sync:syncNow'),
  onAwsSyncStatusChanged: (cb) => ipcRenderer.on('aws-sync:statusChanged', (_e, data) => cb(data)),

  // AWS Sync opt-in controls (feature 148)
  awsSyncEnable: () => ipcRenderer.invoke('aws-sync:enable'),
  awsSyncDisable: () => ipcRenderer.invoke('aws-sync:disable'),
  awsSyncPause: () => ipcRenderer.invoke('aws-sync:pause'),
  awsSyncResume: () => ipcRenderer.invoke('aws-sync:resume'),
  awsSyncUnlink: (opts) => ipcRenderer.invoke('aws-sync:unlink', opts),
  // AWS Sync first-run consent preference (feature 149)
  getAwsSyncPromptShown: () => ipcRenderer.invoke('preferences:getAwsSyncPromptShown'),
  setAwsSyncPromptShown: (value) => ipcRenderer.invoke('preferences:setAwsSyncPromptShown', value),

  // SSH Sync endpoints (decoupled from OpenClaw)
  getSshSyncEndpoints: () => ipcRenderer.invoke('ssh-sync:getEndpoints'),
  addSshSyncEndpoint: (endpoint) => ipcRenderer.invoke('ssh-sync:add', endpoint),
  updateSshSyncEndpoint: (endpoint) => ipcRenderer.invoke('ssh-sync:update', endpoint),
  removeSshSyncEndpoint: (id) => ipcRenderer.invoke('ssh-sync:remove', id),
  onSshSyncEndpointsChanged: (cb) => ipcRenderer.on('ssh-sync:endpointsChanged', () => cb()),

  // Server Sync (SSH/SFTP)
  serverSyncGetStatus: () => ipcRenderer.invoke('server-sync:getStatus'),
  serverSyncGetEndpointStatus: (id) => ipcRenderer.invoke('server-sync:getEndpointStatus', id),
  serverSyncEnable: (id) => ipcRenderer.invoke('server-sync:enable', id),
  serverSyncDisable: (id) => ipcRenderer.invoke('server-sync:disable', id),
  serverSyncPauseAll: () => ipcRenderer.invoke('server-sync:pauseAll'),
  serverSyncResumeAll: () => ipcRenderer.invoke('server-sync:resumeAll'),
  serverSyncNow: (id) => ipcRenderer.invoke('server-sync:syncNow', id),
  serverSyncTestSsh: (config) => ipcRenderer.invoke('server-sync:testSsh', config),
  onServerSyncStatusChanged: (cb) => ipcRenderer.on('server-sync:statusChanged', (_e, data) => cb(data)),
  onServerSyncContentStatus: (cb) => ipcRenderer.on('server-sync:contentStatusChanged', (_e, data) => cb(data)),

  // Sync ignore (.syncignore / .gitignore) editor
  syncIgnoreRead: (type) => ipcRenderer.invoke('sync-ignore:read', type),
  syncIgnoreWrite: (type, content) => ipcRenderer.invoke('sync-ignore:write', type, content),

  // Note security settings
  getSecuritySettings: () => ipcRenderer.invoke('security:getSettings'),
  setSecuritySettings: (settings) => ipcRenderer.invoke('security:setSettings', settings),

  // Context snapshot — shared .context/ folder for external tools
  updateContextQuotes: (items) => ipcRenderer.invoke('context:updateQuotes', items),
  updateContextCurrentNote: (noteInfo) => ipcRenderer.invoke('context:updateCurrentNote', noteInfo),
});

contextBridge.exposeInMainWorld("storageInspector", {
  listKV:        (noteId)                => ipcRenderer.invoke('note-db:list-all',          noteId),
  listFiles:     (noteId)                => ipcRenderer.invoke('note-files:list-details',    noteId),
  listTables:    (noteId)                => ipcRenderer.invoke('note-sql:tables',            noteId),
  queryReadonly: (noteId, sql, params)   => ipcRenderer.invoke('note-sql:query-readonly',    noteId, sql, params),
  getKV:         (noteId, key)           => ipcRenderer.invoke('note-db:get',               noteId, key),
  deleteKV:      (noteId, key)           => ipcRenderer.invoke('note-db:delete',            noteId, key),
  kvSchema:      (noteId)                => ipcRenderer.invoke('note-kv:schema',             noteId),
  readMemory:    (noteId)                => ipcRenderer.invoke('note-memory:read',            noteId),
  writeMemory:   (noteId, content)       => ipcRenderer.invoke('note-memory:write',           noteId, content),
  listScripts:   (noteId)                => ipcRenderer.invoke('note-scripts:list',            noteId),
  approveScript: (noteId, name)          => ipcRenderer.invoke('note-scripts:approve',         noteId, name),
  revokeScript:  (noteId, name)          => ipcRenderer.invoke('note-scripts:revoke',          noteId, name),
  listRunning:   ()                      => ipcRenderer.invoke('note-scripts:running'),
  stopScript:    (runId)                 => ipcRenderer.invoke('note-scripts:stop',             runId),
  getScriptEnv:    (noteId)              => ipcRenderer.invoke('note-scripts:get-env',          noteId),
  setScriptEnv:    (noteId, config)      => ipcRenderer.invoke('note-scripts:set-env',          noteId, config),
  detectScriptEnv: (noteId)              => ipcRenderer.invoke('note-scripts:detect-env',       noteId),
  listLogs:      (noteId)                => ipcRenderer.invoke('note-logs:list',               noteId),
  readLog:       (noteId, logName)       => ipcRenderer.invoke('note-logs:read',               noteId, logName),
  clearLog:      (noteId, logName)       => ipcRenderer.invoke('note-logs:clear',              noteId, logName),
  getLoggingEnabled: ()                  => ipcRenderer.invoke('note-logging:get'),
  setLoggingEnabled: (enabled)           => ipcRenderer.invoke('note-logging:set',             enabled),
});
