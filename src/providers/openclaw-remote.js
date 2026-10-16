'use strict';
const fs = require('fs');
const path = require('path');
const { OpenClawBridge } = require('./openclaw-bridge');
const {
  readRemoteDeviceIdentity,
  writeRemoteDeviceIdentity,
  generateDeviceIdentity,
  readRemoteDeviceToken,
  readRemotePairedMetadata,
  readRemoteGatewayToken,
} = require('./openclaw-remote-auth');
const { normalizeOpenClaw } = require('./events');

/**
 * Factory that creates an OpenClaw remote WebSocket provider for a given endpoint config.
 *
 * @param {{ id, label, url }} endpoint
 */
function createOpenClawRemoteProvider(endpoint) {
  const _bridge = new OpenClawBridge();
  let _activeHandle = null;

  function _buildAuthConfig() {
    // Always use device auth; include gateway token if available
    let deviceIdentity = readRemoteDeviceIdentity(endpoint.id);
    if (!deviceIdentity) {
      deviceIdentity = generateDeviceIdentity();
      writeRemoteDeviceIdentity(endpoint.id, deviceIdentity);
    }
    const deviceToken = readRemoteDeviceToken(endpoint.id);
    const pairedMeta = readRemotePairedMetadata(endpoint.id);
    const gatewayToken = readRemoteGatewayToken(endpoint.id) || undefined;
    return { deviceIdentity, deviceToken, pairedMeta, gatewayToken };
  }

  return {
    name: `openclaw-remote:${endpoint.id}`,
    label: endpoint.label,
    type: 'websocket',
    supportsResume: false,
    supportsEffort: false,
    permissionModes: [],
    models: [],
    endpointConfig: endpoint,

    async discoverModels() {
      try {
        if (!_bridge.isConnected()) {
          await _bridge.connectWithMode(endpoint.url, _buildAuthConfig());
        }
        const result = await _bridge.sendRequest('models.list', {});
        // Accept both array and { models: [...] } response shapes
        const list = Array.isArray(result)
          ? result
          : (Array.isArray(result?.models) ? result.models : []);
        const normalized = list.map(m => ({
          id: m.id || m.name || String(m),
          label: m.label || m.name || m.id || String(m),
        })).filter(m => m.id);
        this.models = normalized;
        return normalized;
      } catch {
        return [];
      }
    },

    send(prompt, opts) {
      const authConfig = _buildAuthConfig();

      // Prepend workspace instructions on first message of a session (same as local provider)
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

      _activeHandle = _bridge.chatSendWithAuth({
        url: endpoint.url,
        authConfig,
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
}

module.exports = { createOpenClawRemoteProvider };
