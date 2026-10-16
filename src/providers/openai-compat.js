'use strict';

const fs = require('fs');
const path = require('path');
const { sendToOpenAICompat } = require('./openai-compat-bridge');
const { normalizeOpenAICompat } = require('./events');

/**
 * Factory that creates an OpenAI-compatible HTTP provider for a given endpoint config.
 *
 * @param {{ id, label, baseUrl, apiKey, modelId }} endpoint
 */
function createOpenAICompatProvider(endpoint) {
  let _handle = null;

  return {
    name: `openai-compat:${endpoint.id}`,
    label: endpoint.label,
    type: 'http',
    supportsResume: false,
    supportsEffort: false,
    permissionModes: [],
    models: [],
    endpointConfig: endpoint,

    send(prompt, opts) {
      let messages;
      if (opts.messages && opts.messages.length > 0) {
        messages = opts.messages.map(m => ({ role: m.role, content: m.content }));
      } else {
        messages = [{ role: 'user', content: prompt }];
      }

      // Inject workspace instructions as system message
      if (opts.cwd) {
        try {
          const instructions = fs.readFileSync(
            path.join(opts.cwd, '.claude', 'CLAUDE.md'), 'utf8'
          ).trim();
          if (instructions) {
            messages.unshift({ role: 'system', content: instructions });
          }
        } catch {}
      }

      const model = opts.model || endpoint.modelId;

      _handle = sendToOpenAICompat({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model,
        messages,
        onEvent(rawChunk) {
          const normalized = normalizeOpenAICompat(rawChunk);
          for (const event of normalized) {
            opts.onEvent(event);
          }
        },
        onError: opts.onError,
        onDone: opts.onDone,
      });

      return _handle;
    },

    cancel() {
      _handle?.abort();
      _handle = null;
    },

    reset() {
      this.cancel();
    },
  };
}

module.exports = { createOpenAICompatProvider };
