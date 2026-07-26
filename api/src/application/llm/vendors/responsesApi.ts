/**
 * responsesApi — the ONE chat-completions ⇄ OpenAI *Responses* API translation.
 *
 * Two vendors speak the Responses shape rather than chat-completions: `xai-oauth`
 * (Grok, `api.x.ai/v1/responses`) and `openai-codex` (the private Codex backend).
 * Both hand-rolled the identical `instructions` / `input` / `tools` mapping and the
 * identical response normalization — and they DRIFTED: `xai-oauth` never read
 * `params.toolChoice`, so a caller that pinned a specific function (or forced
 * `tool_choice: 'required'`) silently got plain `auto` on Grok with no error, which
 * is one more way a forced-tool turn comes back as prose. This module is the single
 * source so the two can't diverge again; per-vendor quirks ride `opts.extra`
 * (Codex's CLI-only `stream` / `include` fields).
 *
 * @see {@link ./pseudoStream} for the other half of the shared Responses path — the
 * OpenAI-shaped SSE replay both vendors return from `callStream`.
 */
import { pickUsage, type VendorCallParams, type VendorCallResult } from './types';

/**
 * The Responses surface rejects a `max_output_tokens` below this. A connection
 * probe asks for very few tokens, so the cap is floored rather than passed
 * through verbatim — otherwise a healthy credential fails "Test connection".
 */
export const MIN_OUTPUT_TOKENS = 16;

export interface ResponsesBodyOptions {
  /** Extra top-level fields merged last — the per-vendor request contract (the Codex
   *  backend requires `stream: true` + `include: ['reasoning.encrypted_content']`). */
  extra?: Record<string, unknown>;
}

/** Flatten a chat-completions `{ type:'function', function:{…} }` tool to the Responses
 *  shape (`{ type:'function', name, description, parameters }`), leaving any other tool
 *  type (e.g. a built-in server tool) untouched. */
function toResponsesTools(tools: unknown[] | undefined): unknown[] | undefined {
  return tools?.map((raw) => {
    const tool = raw as { type?: string; function?: Record<string, unknown> };
    return tool.type === 'function' && tool.function ? { type: 'function', ...tool.function } : raw;
  });
}

/**
 * Translate a chat-completions `tool_choice` to the Responses shape.
 *
 * The string forms (`'auto'` / `'none'` / `'required'`) are identical across both
 * APIs and pass through. The pinned-function form is NOT: chat-completions nests it
 * (`{ type:'function', function:{ name } }`) while Responses flattens it
 * (`{ type:'function', name }`), and an unflattened object is ignored upstream —
 * i.e. a forced tool silently degrades to `auto`.
 */
function toResponsesToolChoice(toolChoice: unknown): unknown {
  const choice = toolChoice as { type?: string; function?: { name?: string } } | string | undefined;
  return choice && typeof choice === 'object' && choice.type === 'function'
    ? { type: 'function', name: choice.function?.name }
    : choice;
}

/** System/developer turns become the top-level `instructions` string; Responses has no
 *  system role. Non-string content is serialized rather than stringified to
 *  `[object Object]`. */
function toInstructions(messages: Array<Record<string, unknown>>): string {
  return messages
    .filter((message) => message['role'] === 'system' || message['role'] === 'developer')
    .map((message) => typeof message['content'] === 'string' ? message['content'] : JSON.stringify(message['content'] ?? ''))
    .filter(Boolean)
    .join('\n\n') || 'You are a helpful assistant.';
}

/**
 * Translate the remaining turns into Responses `input` items: a `tool` message becomes
 * a `function_call_output`, an assistant turn's `tool_calls` become sibling
 * `function_call` items, and text content is wrapped in the role-appropriate part type
 * (`output_text` for assistant, `input_text` otherwise).
 */
function toInput(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return messages
    .filter((message) => message['role'] !== 'system' && message['role'] !== 'developer')
    .flatMap((message) => {
      const role = String(message['role'] ?? 'user');
      if (role === 'tool') {
        return [{
          type: 'function_call_output',
          call_id: String(message['tool_call_id'] ?? ''),
          output: typeof message['content'] === 'string' ? message['content'] : JSON.stringify(message['content'] ?? ''),
        }];
      }
      const items: Array<Record<string, unknown>> = [];
      if (message['content'] !== undefined && message['content'] !== null && message['content'] !== '') {
        const content = typeof message['content'] === 'string'
          ? [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: message['content'] }]
          : message['content'];
        items.push({ role, content });
      }
      if (role === 'assistant' && Array.isArray(message['tool_calls'])) {
        for (const raw of message['tool_calls']) {
          const call = raw as { id?: string; function?: { name?: string; arguments?: string } };
          items.push({ type: 'function_call', call_id: call.id ?? '', name: call.function?.name ?? '', arguments: call.function?.arguments ?? '{}' });
        }
      }
      return items;
    });
}

/** Build the Responses request body from vendor-neutral call params. */
export function buildResponsesBody(params: VendorCallParams, opts?: ResponsesBodyOptions): Record<string, unknown> {
  const tools = toResponsesTools(params.tools);
  const toolChoice = toResponsesToolChoice(params.toolChoice);
  const maxOutputTokens = params.maxTokens ? Math.max(params.maxTokens, MIN_OUTPUT_TOKENS) : undefined;
  return {
    model: params.model,
    instructions: toInstructions(params.messages),
    input: toInput(params.messages),
    store: false,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
    ...opts?.extra,
  };
}

/** The terminal Responses object both vendors read, whether it arrived as plain JSON or
 *  as the `response.completed` frame of an SSE stream. */
export interface ResponsesPayload {
  id?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }>; name?: string; arguments?: string; call_id?: string }>;
  output_text?: string;
  usage?: unknown;
  error?: { message?: string } | string;
}

/**
 * Normalize a Responses payload back into the OpenAI chat-completion shape the rest of
 * the gateway (and {@link pseudoStreamFromCall}) consumes: `output_text` (or the
 * concatenated `output_text` parts) as content, `function_call` items as `tool_calls`,
 * and a `tool_calls` finish reason whenever any were emitted.
 */
export function normalizeResponsesPayload(raw: ResponsesPayload): VendorCallResult {
  const content = raw.output_text
    ?? raw.output?.flatMap((item) => item.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('')
    ?? '';
  const toolCalls = raw.output?.filter((item) => item.type === 'function_call').map((item, index) => ({
    id: item.call_id ?? `call_${index}`,
    type: 'function',
    function: { name: item.name ?? '', arguments: item.arguments ?? '{}' },
  })) ?? [];
  const usage = pickUsage(raw.usage);
  const chatRaw = {
    id: raw.id ?? `chatcmpl_${crypto.randomUUID()}`,
    object: 'chat.completion',
    choices: [{
      index: 0,
      message: { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
    }],
    usage,
  };
  return { raw: chatRaw, content, usage };
}
