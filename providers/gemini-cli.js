'use strict';
const { sendToGemini } = require('./gemini-bridge');
const { normalizeGemini } = require('./events');

let _proc = null;

module.exports = {
  name: 'gemini-cli',
  type: 'cli',
  supportsResume: false,
  permissionModes: [
    { id: 'default',   label: 'Default',   description: 'Prompt for approval on each action' },
    { id: 'auto_edit', label: 'Auto Edit', description: 'Auto-approve edit tools' },
    { id: 'plan',      label: 'Plan',      description: 'Read-only mode' },
    { id: 'yolo',      label: 'YOLO',      description: 'Auto-approve all tools' },
  ],
  models: [
    { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],

  send(prompt, opts) {
    _proc = sendToGemini({
      prompt,
      cwd: opts.cwd,
      model: opts.model,
      permissionMode: opts.permissionMode,
      onEvent(rawEvent) {
        for (const evt of normalizeGemini(rawEvent)) {
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
