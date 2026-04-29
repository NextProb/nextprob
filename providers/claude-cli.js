'use strict';
const { sendToClaude } = require('../bridge');
const { normalizeClaude } = require('./events');

let _proc = null;

module.exports = {
  name: 'claude-cli',
  type: 'cli',
  supportsResume: true,
  supportsEffort: true,
  permissionModes: [
    { id: 'default',           label: 'Default',            description: 'Prompt for approval on each action' },
    { id: 'acceptEdits',       label: 'Accept Edits',       description: 'Auto-approve file edits, prompt for others' },
    { id: 'plan',              label: 'Plan',               description: 'Read-only mode, no writes allowed' },
    { id: 'dontAsk',           label: "Don't Ask",          description: 'Run without asking for approval' },
    { id: 'auto',              label: 'Auto',               description: 'Auto-approve all tool calls' },
    { id: 'bypassPermissions', label: 'Bypass Permissions', description: 'Bypass all permission checks' },
  ],
  models: [
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'opus',   label: 'Opus' },
    { id: 'haiku',  label: 'Haiku' },
  ],

  send(prompt, opts) {
    _proc = sendToClaude({
      prompt,
      cwd: opts.cwd,
      sessionId: opts.sessionId,
      isResume: opts.isResume,
      model: opts.model,
      effort: opts.effort,
      permissionMode: opts.permissionMode,
      unsetApiKeys: opts.unsetApiKeys,
      onEvent(rawEvent) {
        for (const evt of normalizeClaude(rawEvent)) {
          opts.onEvent(evt);
        }
      },
      onError: opts.onError,
      onDone: opts.onDone,
    });
    return _proc;
  },

  cancel() {
    if (_proc) {
      _proc.kill();
      _proc = null;
    }
  },

  reset() {
    this.cancel();
  },
};
