'use strict';

/** Canonical event type strings. Import these instead of writing raw string literals. */
const TYPES = {
  TEXT_DELTA:  'text_delta',
  TEXT_DONE:   'text_done',
  TOOL_USE:    'tool_use',
  TOOL_RESULT: 'tool_result',
  ERROR:       'error',
  DONE:        'done',
};

/** Incremental streaming text chunk. */
function textDelta(text)          { return { type: TYPES.TEXT_DELTA,  text }; }
/** Final assembled text (non-streaming full response, or last assembled block). */
function textDone(text)           { return { type: TYPES.TEXT_DONE,   text }; }
/** Tool invocation (name + input params). */
function toolUse(name, input)     { return { type: TYPES.TOOL_USE,    name, input }; }
/** Tool execution result. name may be null if not available from raw event. */
function toolResult(name, output) { return { type: TYPES.TOOL_RESULT, name, output }; }
/** Provider-level error (not stderr — reserved for API error responses). */
function error(message)           { return { type: TYPES.ERROR,       message }; }
/** Stream finished. stop_reason from provider (e.g. "end_turn", "max_tokens"). */
function done(stopReason)         { return { type: TYPES.DONE,        stop_reason: stopReason }; }

/**
 * Map a raw Claude CLI stream-json event to an array of normalized events.
 * Returns an array because one raw event (e.g. "assistant") can contain
 * multiple content blocks that each become a separate normalized event.
 * Returns [] for events that have no normalized representation (e.g. "user").
 *
 * @param {object} raw - A parsed stream-json event from Claude CLI.
 * @returns {object[]} Array of normalized events.
 */
function normalizeClaude(raw) {
  if (!raw || !raw.type) return [];

  switch (raw.type) {
    case 'content_block_delta':
      if (raw.delta && raw.delta.text) {
        return [textDelta(raw.delta.text)];
      }
      return [];

    case 'assistant': {
      const blocks = raw.message && raw.message.content;
      if (!blocks) return [];
      const out = [];
      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          out.push(textDone(block.text));
        } else if (block.type === 'tool_use') {
          out.push(toolUse(block.name, block.input));
        }
        // 'thinking' blocks are intentionally ignored (not rendered)
      }
      return out;
    }

    case 'tool':
    case 'tool_result': {
      const content = (raw.tool && raw.tool.content) || raw.content || '';
      return [toolResult(null, String(content))];
    }

    case 'result':
      return [done(raw.subtype || 'end_turn')];

    default:
      // 'user' and any other unknown types are silently ignored
      return [];
  }
}

/**
 * Map a raw Codex CLI JSONL event to an array of normalized events.
 * Returns [] for events with no normalized representation (thread.started, turn.started, reasoning, etc.).
 *
 * @param {object} raw - A parsed JSONL event from Codex CLI.
 * @returns {object[]} Array of normalized events.
 */
function normalizeCodex(raw) {
  if (!raw || !raw.type) return [];

  switch (raw.type) {
    case 'item.completed': {
      const item = raw.item;
      if (!item) return [];
      switch (item.type) {
        case 'agent_message':
          return item.text ? [textDone(item.text)] : [];
        case 'command_execution':
          return [toolResult('command_execution', item.output || '')];
        case 'mcp_tool_call':
          return [toolResult(item.function_name || 'mcp_tool', item.output || '')];
        case 'file_change':
          return [toolResult('file_change', item.path || '')];
        case 'web_search':
          return [toolResult('web_search', item.output || '')];
        default:
          return [];
      }
    }

    case 'item.started': {
      const item = raw.item;
      if (!item) return [];
      switch (item.type) {
        case 'command_execution':
          return [toolUse('command_execution', { command: item.command || '' })];
        case 'mcp_tool_call':
          return [toolUse(item.function_name || 'mcp_tool', item.input || {})];
        case 'file_change':
          return [toolUse('file_change', { path: item.path || '' })];
        case 'web_search':
          return [toolUse('web_search', { query: item.query || '' })];
        default:
          return [];
      }
    }

    case 'turn.completed':
      return [done('end_turn')];

    case 'turn.failed':
      return [error('Codex turn failed'), done('turn_failed')];

    case 'error':
      return [error(raw.message || 'Codex error')];

    default:
      // thread.started, turn.started, reasoning items, etc. — silently ignored
      return [];
  }
}

/**
 * Map a raw Gemini CLI stream-json event to an array of normalized events.
 * Returns [] for events with no normalized representation (init, user messages, etc.).
 *
 * @param {object} raw - A parsed JSONL event from Gemini CLI --output-format stream-json.
 * @returns {object[]} Array of normalized events.
 */
function normalizeGemini(raw) {
  if (!raw || !raw.type) return [];

  switch (raw.type) {
    case 'message':
      if (raw.role !== 'assistant') return [];
      if (!raw.content) return [];
      if (raw.delta === true) {
        return [textDelta(raw.content)];
      }
      return [textDone(raw.content)];

    case 'tool_use':
      return [toolUse(raw.tool_name || 'tool', raw.parameters || {})];

    case 'tool_result':
      return [toolResult(null, raw.output != null ? String(raw.output) : '')];

    case 'error':
      return [error(raw.message || raw.error || 'Gemini error')];

    case 'result':
      if (raw.status === 'error') {
        return [error(raw.message || 'Gemini request failed'), done('error')];
      }
      return [done('end_turn')];

    default:
      // 'init' and any unknown types are silently ignored
      return [];
  }
}

/**
 * Map a raw OpenAI-compatible SSE chunk (already JSON.parse'd) to an array of normalized events.
 *
 * @param {object} raw - A parsed SSE data payload from an OpenAI-compatible endpoint.
 * @returns {object[]} Array of normalized events.
 */
function normalizeOpenAICompat(raw) {
  try {
    if (!raw || !raw.choices || !raw.choices[0]) return [];
    const choice = raw.choices[0];
    const out = [];
    if (choice.delta && typeof choice.delta.content === 'string' && choice.delta.content !== '') {
      out.push(textDelta(choice.delta.content));
    }
    if (choice.finish_reason != null && choice.finish_reason !== '') {
      out.push(done(choice.finish_reason));
    }
    return out;
  } catch (e) {
    return [error(e.message)];
  }
}

/**
 * Map a raw OpenClaw gateway event frame to an array of normalized events.
 * Called for every {type:"event"} frame received while a chat.send is pending.
 *
 * OpenClaw uses block-based streaming — text arrives in completed blocks,
 * not character-by-character deltas. Each block becomes one textDelta call.
 *
 * @param {object} frame - A parsed gateway event frame: {type:"event", event:string, payload:object}
 * @returns {object[]} Array of normalized events.
 */
function normalizeOpenClaw(frame) {
  if (!frame || frame.type !== 'event') return [];

  const payload = frame.payload || {};
  const eventName = frame.event || '';

  // Agent assistant stream — text deltas (preferred for incremental display)
  if (eventName === 'agent' && payload.stream === 'assistant' && payload.data?.delta) {
    return [textDelta(payload.data.delta)];
  }

  // Chat delta/final — full message content blocks
  // Only use chat events as fallback if we didn't get the agent delta
  if (eventName === 'chat' && payload.message?.content) {
    const content = payload.message.content;
    const texts = [];
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text);
      }
    }
    // For "final" state, emit done after the text
    if (payload.state === 'final' && texts.length > 0) {
      return [done('end')];
    }
    // Skip chat deltas — we use agent deltas above for incremental text
    return [];
  }

  // Agent lifecycle end
  if (eventName === 'agent' && payload.stream === 'lifecycle' && payload.data?.phase === 'end') {
    return [done('end')];
  }

  // Legacy/fallback text shapes for forward compatibility
  const text =
    (typeof payload.text === 'string' && payload.text) ||
    (typeof payload.content === 'string' && payload.content) ||
    (typeof payload.block?.text === 'string' && payload.block.text) ||
    null;

  if (text) {
    return [textDelta(text)];
  }

  // Error events from the gateway during streaming
  if (eventName.includes('error') || payload.error) {
    const msg = payload.error || payload.message || 'OpenClaw streaming error';
    return [error(typeof msg === 'string' ? msg : JSON.stringify(msg))];
  }

  // All other events (health checks, typing indicators, etc.) — silently ignore
  return [];
}

module.exports = { TYPES, textDelta, textDone, toolUse, toolResult, error, done, normalizeClaude, normalizeCodex, normalizeGemini, normalizeOpenAICompat, normalizeOpenClaw };
