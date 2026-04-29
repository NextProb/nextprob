'use strict';
const fs = require('fs');
const path = require('path');
const { OpenClawBridge } = require('./openclaw-bridge');
const {
  readOpenClawGatewayUrl,
  readOpenClawDeviceIdentity,
  readOpenClawDeviceToken,
  readOpenClawPairedMetadata,
} = require('./openclaw-auth');
const { normalizeOpenClaw } = require('./events');

// Singleton bridge — persists connection across messages in a conversation
const _bridge = new OpenClawBridge();

let _activeHandle = null;

module.exports = {
  name: 'openclaw',
  label: 'OpenClaw (Local)',
  type: 'websocket',
  supportsResume: false,
  supportsEffort: false,
  permissionModes: [],
  models: [
    { id: 'openclaw:main', label: 'Main' },
  ],

  send(prompt, opts) {
    const deviceIdentity = readOpenClawDeviceIdentity();
    if (!deviceIdentity) {
      opts.onError(
        'OpenClaw device identity not found. ' +
        'Expected: ~/.openclaw/identity/device.json — run OpenClaw once to generate it.'
      );
      opts.onDone(1);
      return { cancel: () => {} };
    }

    const deviceToken = readOpenClawDeviceToken();
    if (!deviceToken) {
      opts.onError(
        'OpenClaw device token not found. ' +
        'Expected: ~/.openclaw/identity/device-auth.json — pair your device with OpenClaw first.'
      );
      opts.onDone(1);
      return { cancel: () => {} };
    }

    const url = readOpenClawGatewayUrl();
    const pairedMeta = readOpenClawPairedMetadata(deviceIdentity.deviceId);

    // Prepend workspace instructions on the first message of a session only.
    // OpenClaw maintains server-side conversation state, so subsequent
    // messages already have the instructions in context.
    let text = prompt;
    if (opts.cwd && opts.messageCount === 1) {
      try {
        const instructions = fs.readFileSync(
          path.join(opts.cwd, '.claude', 'CLAUDE.md'), 'utf8'
        ).trim();
        if (instructions) {
          text = '[Workspace Instructions]\n' + instructions + '\n[/Workspace Instructions]\n\n' + prompt;
        }
      } catch {}
    }

    _activeHandle = _bridge.chatSend({
      url,
      deviceIdentity,
      deviceToken,
      pairedMeta,
      sessionKey: opts.sessionId,
      text,
      onStreamEvent(frame) {
        const normalized = normalizeOpenClaw(frame);
        for (const event of normalized) {
          opts.onEvent(event);
        }
      },
      onError: opts.onError,
      onDone: opts.onDone,
    });

    return _activeHandle;
  },

  cancel() {
    if (_activeHandle) {
      _activeHandle.cancel();
      _activeHandle = null;
    }
  },

  reset() {
    this.cancel();
  },
};
