'use strict';

/**
 * sendToOpenAICompat — POST to an OpenAI-compatible /chat/completions endpoint with SSE streaming.
 *
 * Returns { abort } synchronously. Async work fires in the background.
 */
function sendToOpenAICompat({ baseUrl, apiKey, model, messages, onEvent, onError, onDone }) {
  const controller = new AbortController();

  (async () => {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, stream: true }),
        signal: controller.signal,
      });

      if (!response.ok) {
        onError(`HTTP ${response.status}: ${response.statusText}`);
        onDone(1);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';

      function processLine(line) {
        if (!line) return;
        if (!line.startsWith('data: ')) return;
        const value = line.slice(6);
        if (value === '[DONE]') return;
        try {
          const parsed = JSON.parse(value);
          onEvent(parsed);
        } catch {
          // skip malformed chunks
        }
      }

      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (value) {
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop(); // keep incomplete last line
          for (const line of lines) processLine(line.trimEnd());
        }
        if (readerDone) {
          // Flush remaining buffer
          if (lineBuffer) {
            processLine(lineBuffer.trimEnd());
            lineBuffer = '';
          }
          break;
        }
      }

      onDone(0);
    } catch (err) {
      if (err.name === 'AbortError') {
        onDone(1);
      } else {
        onError(err.message);
        onDone(1);
      }
    }
  })();

  return { abort: () => controller.abort() };
}

/**
 * fetchModels — GET /models from an OpenAI-compatible endpoint.
 * Returns array of { id, label } or [] on any error.
 */
async function fetchModels({ baseUrl, apiKey }) {
  try {
    const headers = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const response = await fetch(`${baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const json = await response.json();
    const data = json.data || [];
    return data.map(entry => ({ id: entry.id, label: entry.id }));
  } catch {
    return [];
  }
}

module.exports = { sendToOpenAICompat, fetchModels };
