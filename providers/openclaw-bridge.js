'use strict';
const WebSocket = require('ws');
const crypto = require('crypto');

const CONNECT_TIMEOUT_MS = 5000;
const HANDSHAKE_TIMEOUT_MS = 5000;
const HANDSHAKE_REQ_ID = 'oc-connect';

class OpenClawBridge {
  constructor() {
    this._ws = null;
    this._connected = false;
    this._nextId = 1;
    this._pending = new Map(); // id → { resolve, reject }
    this._runListeners = new Map(); // runId → callback(frame)
    this._url = null;
  }

  isConnected() {
    return this._connected && this._ws && this._ws.readyState === WebSocket.OPEN;
  }

  /**
   * Connect to the OpenClaw gateway and perform the v3 device-auth handshake.
   * @param {string} url - WebSocket URL (e.g. ws://127.0.0.1:18789)
   * @param {object} deviceIdentity - { deviceId, privateKeyPem, publicKeyPem }
   * @param {string} deviceToken - operator device token from device-auth.json
   * @param {object} pairedMeta - { clientId, clientMode, platform, scopes }
   */
  connect(url, deviceIdentity, deviceToken, pairedMeta, gatewayToken) {
    this._url = url;

    const privateKey = crypto.createPrivateKey(deviceIdentity.privateKeyPem);
    const publicKey = crypto.createPublicKey(deviceIdentity.publicKeyPem);
    const rawPubKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).slice(-32).toString('base64');

    return new Promise((resolve, reject) => {
      let handshakeTimer = null;
      let settled = false;

      const settle = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(handshakeTimer);
        if (err) reject(err);
        else resolve();
      };

      const connectTimer = setTimeout(() => {
        settle(new Error(`Cannot connect to OpenClaw at ${url}. Is OpenClaw running?`));
        try { ws.terminate(); } catch {}
      }, CONNECT_TIMEOUT_MS);

      const ws = new WebSocket(url);
      this._ws = ws;

      ws.on('open', () => {
        clearTimeout(connectTimer);
        handshakeTimer = setTimeout(() => {
          settle(new Error('OpenClaw handshake timed out. No challenge received.'));
          try { ws.terminate(); } catch {}
        }, HANDSHAKE_TIMEOUT_MS);
      });

      ws.on('message', (data) => {
        let frame;
        try { frame = JSON.parse(data); } catch { return; }

        if (!this._connected) {
          if (frame.type === 'event' && frame.event === 'connect.challenge') {
            const nonce = frame.payload?.nonce;
            const signedAt = Date.now();
            const scopeStr = pairedMeta.scopes.join(',');

            // v3 signature payload: pipe-delimited fields
            const sigPayload = [
              'v3', deviceIdentity.deviceId, pairedMeta.clientId,
              pairedMeta.clientMode, 'operator', scopeStr,
              signedAt, deviceToken, nonce,
              pairedMeta.platform, '',
            ].join('|');
            const signature = crypto.sign(null, Buffer.from(sigPayload, 'utf8'), privateKey).toString('base64');

            const connectReq = {
              type: 'req',
              id: HANDSHAKE_REQ_ID,
              method: 'connect',
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: 'cli',
                  version: '1.0.0',
                  platform: pairedMeta.platform,
                  mode: 'cli',
                },
                role: 'operator',
                scopes: pairedMeta.scopes,
                caps: [],
                commands: [],
                permissions: {},
                auth: {
                  deviceToken,
                  ...(gatewayToken ? { token: gatewayToken } : {}),
                },
                locale: 'en-US',
                userAgent: 'notes-app/1.0.0',
                device: {
                  id: deviceIdentity.deviceId,
                  publicKey: rawPubKeyB64,
                  signature,
                  signedAt,
                  nonce,
                },
              },
            };
            ws.send(JSON.stringify(connectReq));
          } else if (frame.type === 'res' && frame.id === HANDSHAKE_REQ_ID) {
            if (frame.ok) {
              this._connected = true;
              settle(null);
            } else {
              const errMsg = frame.error?.message || frame.error || 'unknown error';
              settle(new Error(
                `OpenClaw authentication failed: ${errMsg}. ` +
                `Check your device identity in ~/.openclaw/identity/`
              ));
            }
          }
          return;
        }

        // After handshake: route frames to pending requests
        this._dispatch(frame);
      });

      ws.on('error', (err) => {
        if (!this._connected) {
          clearTimeout(connectTimer);
          settle(new Error(`Cannot connect to OpenClaw at ${url}: ${err.message}`));
        } else {
          this._failAllPending('Connection to OpenClaw lost');
          this._connected = false;
        }
      });

      ws.on('close', () => {
        this._connected = false;
        if (!settled) {
          clearTimeout(connectTimer);
          settle(new Error(`OpenClaw WebSocket closed before handshake completed`));
        }
        this._failAllPending('Connection to OpenClaw closed');
      });
    });
  }

  disconnect() {
    this._connected = false;
    if (this._ws) {
      try { this._ws.terminate(); } catch {}
      this._ws = null;
    }
    this._failAllPending('Disconnected');
    this._pending.clear();
  }

  /**
   * Connect to the OpenClaw gateway with a configurable auth mode.
   * Always uses device auth (Ed25519 signing). Optionally includes a gateway token.
   * @param {string} url - WebSocket URL (ws:// or wss://)
   * @param {object} authConfig - { deviceIdentity, deviceToken, pairedMeta, gatewayToken }
   */
  connectWithMode(url, authConfig) {
    return this.connect(
      url,
      authConfig.deviceIdentity,
      authConfig.deviceToken,
      authConfig.pairedMeta,
      authConfig.gatewayToken
    );
  }

  /**
   * High-level chat.send wrapper using auth-mode-aware connection.
   * Mirrors chatSend() but accepts authConfig instead of explicit identity params.
   */
  chatSendWithAuth({ url, authConfig, sessionKey, text, onStreamEvent, onError, onDone }) {
    let cancelled = false;
    let runId = null;

    (async () => {
      try {
        if (!this.isConnected()) {
          await this.connectWithMode(url, authConfig);
        }

        const id = 'r' + (this._nextId++);
        const ackPayload = await new Promise((resolve, reject) => {
          this._pending.set(id, { resolve, reject, onStreamEvent: null });
          const frame = { type: 'req', id, method: 'chat.send', params: {
            sessionKey, message: text, idempotencyKey: crypto.randomUUID(),
          }};
          try { this._ws.send(JSON.stringify(frame)); }
          catch (err) { this._pending.delete(id); reject(err); }
        });

        runId = ackPayload.runId;
        if (!runId) throw new Error('OpenClaw chat.send did not return a runId');

        await new Promise((resolve, reject) => {
          this._runListeners.set(runId, (frame) => {
            if (cancelled) return;
            onStreamEvent(frame);
            const event = frame.event;
            const payload = frame.payload;
            if (event === 'agent' && payload?.stream === 'lifecycle' && payload?.data?.phase === 'end') {
              this._runListeners.delete(runId);
              resolve();
            }
          });
        });

        if (!cancelled) onDone(0);
      } catch (err) {
        if (!cancelled) {
          onError(err.message);
          onDone(1);
        }
      }
    })();

    return {
      cancel: () => {
        cancelled = true;
        if (runId) this._runListeners.delete(runId);
        onDone(1);
      },
    };
  }

  /**
   * Send a request and return a Promise resolving with the response payload.
   * Frame IDs are strings to match the gateway protocol.
   */
  sendRequest(method, params, onStreamEvent) {
    return new Promise((resolve, reject) => {
      const id = 'r' + (this._nextId++);
      this._pending.set(id, { resolve, reject, onStreamEvent: onStreamEvent || null });
      const frame = { type: 'req', id, method, params };
      try {
        this._ws.send(JSON.stringify(frame));
      } catch (err) {
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  _dispatch(frame) {
    if (frame.type === 'res') {
      const entry = this._pending.get(frame.id);
      if (!entry) return;
      this._pending.delete(frame.id);
      if (frame.ok) entry.resolve(frame.payload);
      else entry.reject(new Error(frame.error?.message || frame.error || 'OpenClaw request failed'));
    } else if (frame.type === 'event') {
      // Route events to run listeners by runId
      const runId = frame.payload?.runId;
      if (runId && this._runListeners.has(runId)) {
        const listener = this._runListeners.get(runId);
        try { listener(frame); } catch {}
      }
    }
  }

  _failAllPending(reason) {
    for (const entry of this._pending.values()) {
      try { entry.reject(new Error(reason)); } catch {}
    }
    this._pending.clear();
    this._runListeners.clear();
  }

  /**
   * High-level chat.send wrapper.
   * Sends the message, registers a runId-based event listener for streaming,
   * and completes when the agent lifecycle ends.
   * Returns { cancel }.
   */
  chatSend({ url, deviceIdentity, deviceToken, pairedMeta, sessionKey, text, onStreamEvent, onError, onDone }) {
    let cancelled = false;
    let runId = null;

    (async () => {
      try {
        if (!this.isConnected()) {
          await this.connect(url, deviceIdentity, deviceToken, pairedMeta);
        }

        // Send chat.send — returns immediately with { runId, status: "started" }
        const id = 'r' + (this._nextId++);
        const ackPayload = await new Promise((resolve, reject) => {
          this._pending.set(id, { resolve, reject, onStreamEvent: null });
          const frame = { type: 'req', id, method: 'chat.send', params: {
            sessionKey, message: text, idempotencyKey: crypto.randomUUID(),
          }};
          try { this._ws.send(JSON.stringify(frame)); }
          catch (err) { this._pending.delete(id); reject(err); }
        });

        runId = ackPayload.runId;
        if (!runId) throw new Error('OpenClaw chat.send did not return a runId');

        // Register a listener for this runId's streaming events
        await new Promise((resolve, reject) => {
          this._runListeners.set(runId, (frame) => {
            if (cancelled) return;
            const event = frame.event;
            const payload = frame.payload;

            // Forward events to the stream handler
            onStreamEvent(frame);

            // Detect end of run
            if (event === 'agent' && payload?.stream === 'lifecycle' && payload?.data?.phase === 'end') {
              this._runListeners.delete(runId);
              resolve();
            }
          });
        });

        if (!cancelled) onDone(0);
      } catch (err) {
        if (!cancelled) {
          onError(err.message);
          onDone(1);
        }
      }
    })();

    return {
      cancel: () => {
        cancelled = true;
        if (runId) this._runListeners.delete(runId);
        onDone(1);
      },
    };
  }
}

module.exports = { OpenClawBridge };
