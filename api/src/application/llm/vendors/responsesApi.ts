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
  /**
   * Omit `max_output_tokens` entirely.
   *
   * The PUBLIC Responses surface accepts an output cap; the private ChatGPT Codex
   * backend does not — it answers `400 {"detail":"Unsupported parameter:
   * max_output_tokens"}` and refuses the whole request. (`context_window`,
   * `max_context_window` and `truncation_policy` are rejected the same way; we
   * never send those.) The real Codex CLI never sends the field either — its
   * `model_max_output_tokens` config option is parsed and then unused, which is
   * why captured CLI traffic has no such key — and the output ceiling is a
   * server-side per-model property there, not a per-request one.
   *
   * So this is not a value to clamp, it is a field that must not exist. Set by
   * the Codex vendor only; every other Responses vendor keeps the cap.
   */
  omitMaxOutputTokens?: boolean;
  /**
   * Encode instructions and tools as leading input items instead of the legacy
   * top-level fields. Current Codex 5.6 models use this "Responses Lite"
   * contract and reject the classic shape even for a valid ChatGPT account.
   */
  responsesLite?: boolean;
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

/** A chat-completions content part as callers send it (brain-embedded `ContentPart`). */
interface ChatContentPart {
  type?: string;
  text?: string;
  image_url?: { url?: string; detail?: string } | string;
}

/** The text a message's content carries: string content as-is, the `text` of a part
 *  array joined. Anything else is serialized rather than stringified to
 *  `[object Object]`. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .map((part) => typeof part === 'string' ? part : (part as ChatContentPart | null)?.text)
      .filter((text): text is string => typeof text === 'string');
    if (texts.length > 0) return texts.join('\n');
  }
  return JSON.stringify(content ?? '');
}

/**
 * Translate a message's content into Responses content parts.
 *
 * Chat-completions spells a multimodal turn `{ type:'text' }` + `{ type:'image_url',
 * image_url:{ url } }`; Responses spells the same turn `input_text` + `input_image`, with
 * `image_url` a bare string. The chat parts used to pass through verbatim, so every turn
 * after a pasted screenshot sent a body the Responses surface does not accept, for as long
 * as the image stayed in the transcript. Parts already in the Responses shape
 * (`input_image`, `input_file`, …) pass through untouched. Responses has no assistant
 * image part, so an assistant turn keeps its text only.
 */
function toResponsesContent(role: string, content: unknown): unknown[] {
  const textType = role === 'assistant' ? 'output_text' : 'input_text';
  if (typeof content === 'string') return [{ type: textType, text: content }];
  if (!Array.isArray(content)) return [{ type: textType, text: contentText(content) }];
  return content.flatMap((raw): unknown[] => {
    if (typeof raw === 'string') return [{ type: textType, text: raw }];
    const part = raw as ChatContentPart | null;
    if (part?.type === 'text' || part?.type === 'input_text' || part?.type === 'output_text') {
      return typeof part.text === 'string' ? [{ type: textType, text: part.text }] : [];
    }
    if (part?.type === 'image_url') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      const detail = typeof part.image_url === 'object' ? part.image_url?.detail : undefined;
      return url && role !== 'assistant' ? [{ type: 'input_image', image_url: url, ...(detail ? { detail } : {}) }] : [];
    }
    return [raw];
  });
}

/** System/developer turns become the top-level `instructions` string; Responses has no
 *  system role. */
function toInstructions(messages: Array<Record<string, unknown>>): string {
  return messages
    .filter((message) => message['role'] === 'system' || message['role'] === 'developer')
    .map((message) => contentText(message['content'] ?? ''))
    .filter(Boolean)
    .join('\n\n') || 'You are a helpful assistant.';
}

/**
 * Translate the remaining turns into Responses `input` items: a `tool` message becomes
 * a `function_call_output`, an assistant turn's `tool_calls` become sibling
 * `function_call` items, and content becomes Responses parts ({@link toResponsesContent}).
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
          output: contentText(message['content'] ?? ''),
        }];
      }
      const items: Array<Record<string, unknown>> = [];
      if (message['content'] !== undefined && message['content'] !== null && message['content'] !== '') {
        const content = toResponsesContent(role, message['content']);
        if (content.length > 0) items.push({ role, content });
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
  const maxOutputTokens = opts?.omitMaxOutputTokens || !params.maxTokens
    ? undefined
    : Math.max(params.maxTokens, MIN_OUTPUT_TOKENS);
  const instructions = toInstructions(params.messages);
  const input = toInput(params.messages);
  const encodedInput = opts?.responsesLite
    ? [
        { type: 'additional_tools', role: 'developer', tools: tools ?? [] },
        {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: instructions }],
        },
        ...input.map((item) => item.role && item.content && !item.type
          ? { type: 'message', ...item }
          : item),
      ]
    : input;
  return {
    model: params.model,
    ...(!opts?.responsesLite ? { instructions } : {}),
    input: encodedInput,
    store: false,
    ...(!opts?.responsesLite && tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
    ...opts?.extra,
  };
}

/**
 * The chunk field carrying {@link UpstreamTurnEvidence} to the client. Rides the finish
 * chunk of a translated stream and the top level of a normalized completion; the client
 * (`brain-embedded/src/streamChatCompletion.ts`) reads the same literal.
 */
export const UPSTREAM_EVIDENCE_FIELD = 'x_builderforce_upstream';

/**
 * What the vendor's Responses turn ACTUALLY carried, counted before any translation.
 *
 * A run where Grok made "0 tool calls · 12 text-only" has two opposite explanations: the
 * model never emitted a structured `function_call`, or it did and the translation lost
 * it. The client sees only the translated stream, so it cannot tell them apart. This
 * count can: the diagnostics compare it with the calls that reached the loop.
 */
export interface UpstreamTurnEvidence {
  /** Output items by type, as returned: `reasoning`, `message`, `function_call`, … */
  items: Record<string, number>;
  /** Structured function calls the vendor returned. */
  functionCalls: number;
  /** How many of those appeared ONLY in the terminal output and were rebuilt from it. */
  recovered: number;
}

/** Types the Responses surface (and xAI's chat-completions alias) use for a structured call. */
const FUNCTION_CALL_TYPES = new Set(['function_call', 'tool_call']);

/**
 * Arguments as the chat-completions contract wants them: a JSON string.
 * xAI has been observed to put a parsed object on the item (or nest name/arguments
 * under `function`); leaving either shape un-normalized drops the call's parameters
 * or the call itself.
 */
export function functionCallArguments(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return undefined; }
  }
  return undefined;
}

export interface FunctionCallItem {
  type: 'function_call';
  call_id?: string;
  id?: string;
  name: string;
  /** Empty when the item has not carried arguments yet (deltas still to come). */
  arguments: string;
}

/**
 * A Responses (or aliased) output item as a structured function call, or null.
 * Shared by the buffered normalizer and the stream translator so a `tool_call`
 * alias, a nested `function:{name,arguments}`, or object-shaped arguments cannot
 * be counted as "the model never called" on one path and emitted on the other.
 */
export function asFunctionCallItem(raw: unknown): FunctionCallItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const nested = item['function'] && typeof item['function'] === 'object'
    ? item['function'] as Record<string, unknown>
    : null;
  const type = typeof item['type'] === 'string' ? item['type'] : '';
  const name = (typeof item['name'] === 'string' && item['name'])
    || (typeof nested?.['name'] === 'string' && nested['name'])
    || '';
  const typed = FUNCTION_CALL_TYPES.has(type);
  const inferred = !type && name !== '' && (
    item['call_id'] != null || item['arguments'] != null || nested?.['arguments'] != null
  );
  if (!typed && !inferred) return null;
  const rawArgs = item['arguments'] ?? nested?.['arguments'];
  return {
    type: 'function_call',
    call_id: typeof item['call_id'] === 'string' ? item['call_id'] : undefined,
    id: typeof item['id'] === 'string' ? item['id'] : undefined,
    name,
    arguments: rawArgs === undefined ? '' : (functionCallArguments(rawArgs) ?? '{}'),
  };
}

/** Count a Responses output list. Anything that is not an item list counts as empty. */
export function upstreamTurnEvidence(output: unknown, recovered = 0): UpstreamTurnEvidence {
  const items: Record<string, number> = {};
  let functionCalls = 0;
  for (const raw of Array.isArray(output) ? output : []) {
    const type = typeof (raw as { type?: unknown } | null)?.type === 'string' ? (raw as { type: string }).type : 'unknown';
    items[type] = (items[type] ?? 0) + 1;
    if (asFunctionCallItem(raw)) functionCalls += 1;
  }
  return { items, functionCalls, recovered };
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
  const toolCalls = raw.output?.flatMap((item, index) => {
    const call = asFunctionCallItem(item);
    if (!call) return [];
    return [{
      id: call.call_id ?? call.id ?? `call_${index}`,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments || '{}' },
    }];
  }) ?? [];
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
    [UPSTREAM_EVIDENCE_FIELD]: upstreamTurnEvidence(raw.output),
  };
  return { raw: chatRaw, content, usage };
}
