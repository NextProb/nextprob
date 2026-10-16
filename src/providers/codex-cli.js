'use strict';
const { sendToCodex } = require('./codex-bridge');
const { normalizeCodex } = require('./events');

let _proc = null;

module.exports = {
  name: 'codex-cli',
  type: 'cli',
  supportsResume: false,
  permissionModes: [
    { id: 'read-only',          label: 'Read Only',          description: 'Only read files, no writes' },
    { id: 'workspace-write',    label: 'Workspace Write',    description: 'Write within workspace only' },
    { id: 'danger-full-access', label: 'Full Access',        description: 'Full system access (dangerous)' },
  ],
  models: [
    { id: 'o3',         label: 'o3' },
    { id: 'o4-mini',    label: 'o4-mini' },
    { id: 'codex-mini', label: 'Codex Mini' },
  ],

  send(prompt, opts) {
    _proc = sendToCodex({
      prompt,
      cwd: opts.cwd,
      model: opts.model,
      permissionMode: opts.permissionMode,
      onEvent(rawEvent) {
        for (const evt of normalizeCodex(rawEvent)) {
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
