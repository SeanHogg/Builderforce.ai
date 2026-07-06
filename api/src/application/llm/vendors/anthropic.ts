/**
 * Direct Anthropic (Claude) vendor module — the last-resort reliability FLOOR for
 * cloud CODING runs. Calls Anthropic's native Messages API
 * (`https://api.anthropic.com/v1/messages`) on the operator's `CLAUDE_API_KEY`,
 * NOT an OpenAI-compatible shim — so the coding cascade can fall back to Claude
 * directly when every OpenRouter-routed paid coder is unreachable (OpenRouter
 * outage, key/credit exhausted).
 *
 * Why this exists separately from the `anthropic/claude-sonnet-4.6` OpenRouter
 * slug already in the coding pool: that one is metered/served through OpenRouter
 * and shares OpenRouter's availability. This module is a vendor-diverse, fully
 * independent path on a dedicated Anthropic key — so an OpenRouter-wide failure
 * still resolves through Anthropic. It is `autoRoute: false`: it never enters the
 * FREE/PRO auto pools or the user-facing model picker; it is reached ONLY via the
 * curated coding fallback chain (`CODING_PREMIUM_FALLBACK_MODELS`) or an explicit
 * pin. Builderforce funds these calls, so they are flagged as paid-overflow and
 * capped per-tenant (see `PAID_OVERFLOW_MODELS` in LlmProxyService).
 *
 * Translation: the whole gateway speaks the OpenAI chat-completions shape, so this
 * module translates OpenAI chat → Anthropic Messages on the way in and Anthropic
 * Messages → an OpenAI chat-completion object on the way out (the `raw` it returns
 * is OpenAI-shaped, so the dispatcher's parser, the empty-200 guard, the cloud
 * loop's `parseLlmChoice`, and the SDK consumer all work unchanged).
 *
 * Streaming IS implemented (`callStream`): a tenant's connected BYO account is now the
 * PRIMARY path for streaming surfaces too (IDE chat, knowledge authoring, agent replies),
 * so this vendor must stream — otherwise the streaming dispatcher would skip it and the
 * connected account would never serve those. `callStream` translates Anthropic's SSE
 * Messages event stream → OpenAI `chat.completion.chunk` SSE frames (the pure per-event
 * mapper `anthropicEventToOpenAiChunks` is unit-tested), so downstream consumers are
 * unchanged. The non-streaming `call()` remains for tool loops that need the whole turn.
 */

import {
  AUTH_STATUSES,
  CASCADE_STATUSES,
  fetchWithVendorTimeout,
  parseOpenAIResponse,
  throwClassified4xx,
  VendorRetryableError,
  type AiModelTier,
  type VendorCallParams,
  type VendorCallResult,
  type VendorModelEntry,
  type VendorModule,
  type VendorStreamResult,
} from './types';
import { ANTHROPIC_OAUTH_BETA, CLAUDE_CODE_SYSTEM_PROMPT } from '../anthropicOAuth';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

/**
 * Sentinel the vendor env-resolution encodes a SUBSCRIPTION (OAuth) credential
 * with, so `call()` — which only receives the resolved `apiKey` string, never the
 * env — can tell a subscription bearer token apart from an `sk-ant-…` API key and
 * pick the right auth header. Mirrors the Google OAuth precedent of carrying
 * structured auth inside the apiKey string. An Anthropic API key never starts with
 * this, and an OAuth access token (`sk-ant-oat…`) is prefixed by `apiKeyFrom`. */
const OAUTH_APIKEY_PREFIX = 'oauth:';
/** Anthropic API version header — pinned (the Messages shape we translate to is
 *  stable across this version). */
const ANTHROPIC_VERSION = '2023-06-01';
/** Anthropic returns 529 for "overloaded" — retryable like the 5xx family, but it
 *  is outside the shared `CASCADE_STATUSES` set (which is OpenRouter-shaped). */
const OVERLOADED_STATUS = 529;
/** Default per-turn output budget when the caller didn't set `max_tokens`, capped
 *  so one non-streaming Anthropic call stays inside the vendor timeout budget
 *  (both catalog models support far more, but the floor is a single coding turn). */
const DEFAULT_MAX_TOKENS = 16_000;
const MAX_OUTPUT_TOKENS = 32_000;

// Model ids are the exact Anthropic API strings (no date suffix). These are the
// reliability floor, ordered cheapest-first in the fallback chain: Sonnet first,
// Opus only if Sonnet is also down.
const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: 'claude-sonnet-4-6', tier: 'PREMIUM', label: 'Claude Sonnet 4.6 (Anthropic direct)', brand: 'Anthropic', capabilities: ['tools', 'structured_output', 'vision'] },
  { id: 'claude-opus-4-8',   tier: 'ULTRA',   label: 'Claude Opus 4.8 (Anthropic direct)',   brand: 'Anthropic', capabilities: ['tools', 'structured_output', 'vision'] },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForAnthropicModel(modelId: string): AiModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'PREMIUM';
}

// ---------------------------------------------------------------------------
// OpenAI chat  →  Anthropic Messages  (request translation)
// ---------------------------------------------------------------------------

interface AnthropicBlock { type: string; [k: string]: unknown }
interface AnthropicMessage { role: 'user' | 'assistant'; content: AnthropicBlock[] }

/** Map an OpenAI `tools[]` entry (or an already-Anthropic-shaped one) to the
 *  Anthropic tool schema. */
function toAnthropicTool(t: unknown): Record<string, unknown> | null {
  const tool = t as { function?: { name?: string; description?: string; parameters?: unknown }; name?: string; input_schema?: unknown } | null;
  if (!tool) return null;
  const fn = tool.function;
  if (fn?.name) {
    return {
      name: fn.name,
      ...(fn.description ? { description: fn.description } : {}),
      input_schema: fn.parameters ?? { type: 'object', properties: {} },
    };
  }
  // Already Anthropic-shaped (defensive — callers send OpenAI shape).
  if (tool.name) {
    return { name: tool.name, ...(tool.input_schema ? { input_schema: tool.input_schema } : { input_schema: { type: 'object', properties: {} } }) };
  }
  return null;
}

/** Map OpenAI `tool_choice` to Anthropic's. */
function toAnthropicToolChoice(tc: unknown): Record<string, unknown> | undefined {
  if (tc === 'auto' || tc == null) return { type: 'auto' };
  if (tc === 'required' || tc === 'any') return { type: 'any' };
  if (tc === 'none') return { type: 'auto' }; // keep tools usable; the model self-selects
  const obj = tc as { type?: string; function?: { name?: string } };
  if (obj?.type === 'function' && obj.function?.name) return { type: 'tool', name: obj.function.name };
  return { type: 'auto' };
}

/** Convert an OpenAI `content` array part to an Anthropic content block. */
function toAnthropicContentPart(p: unknown): AnthropicBlock {
  const part = p as { type?: string; text?: string; image_url?: { url?: string } | string } | string | null;
  if (typeof part === 'string') return { type: 'text', text: part };
  if (part?.type === 'text') return { type: 'text', text: part.text ?? '' };
  if (part?.type === 'image_url') {
    const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url ?? '';
    const dataMatch = /^data:([^;]+);base64,(.*)$/s.exec(url);
    if (dataMatch) return { type: 'image', source: { type: 'base64', media_type: dataMatch[1], data: dataMatch[2] } };
    return { type: 'image', source: { type: 'url', url } };
  }
  return { type: 'text', text: typeof part === 'object' && part !== null ? JSON.stringify(part) : String(part ?? '') };
}

interface AnthropicRequest {
  system?: string;
  messages: AnthropicMessage[];
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown>;
}

/**
 * Translate the OpenAI chat request (messages + tools carried via `extraBody`)
 * into an Anthropic Messages request: extract `system`, map `tool`-role results
 * to `tool_result` blocks in a user turn, map assistant `tool_calls` to `tool_use`
 * blocks, and MERGE consecutive same-role turns (Anthropic expects one message per
 * role boundary, where OpenAI emits one tool result per message).
 */
function toAnthropicRequest(params: VendorCallParams): AnthropicRequest {
  const extra = params.extraBody ?? {};
  const systemParts: string[] = [];
  const messages: AnthropicMessage[] = [];

  const push = (role: 'user' | 'assistant', blocks: AnthropicBlock[]) => {
    if (blocks.length === 0) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: [...blocks] });
  };

  for (const raw of params.messages) {
    const m = raw as { role?: string; content?: unknown; tool_calls?: unknown[]; tool_call_id?: string };
    const role = m.role;

    if (role === 'system') {
      if (typeof m.content === 'string') { if (m.content.trim()) systemParts.push(m.content); }
      else if (Array.isArray(m.content)) systemParts.push(m.content.map((p) => (p as { text?: string })?.text ?? '').join(''));
      continue;
    }

    if (role === 'tool') {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id ?? '', content }]);
      continue;
    }

    if (role === 'assistant') {
      const blocks: AnthropicBlock[] = [];
      if (typeof m.content === 'string') { if (m.content) blocks.push({ type: 'text', text: m.content }); }
      else if (Array.isArray(m.content)) for (const p of m.content) { const b = toAnthropicContentPart(p); if (b.type !== 'text' || b.text) blocks.push(b); }
      for (const tcRaw of m.tool_calls ?? []) {
        const tc = tcRaw as { id?: string; function?: { name?: string; arguments?: string } };
        let input: unknown = {};
        try { input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { input = {}; }
        blocks.push({ type: 'tool_use', id: tc.id ?? '', name: tc.function?.name ?? '', input });
      }
      push('assistant', blocks);
      continue;
    }

    // user (and any other role treated as user input)
    if (typeof m.content === 'string') push('user', [{ type: 'text', text: m.content }]);
    else if (Array.isArray(m.content)) push('user', m.content.map(toAnthropicContentPart));
    else push('user', [{ type: 'text', text: String(m.content ?? '') }]);
  }

  const rawTools = Array.isArray(extra.tools) ? extra.tools : undefined;
  const tools = rawTools?.map(toAnthropicTool).filter((t): t is Record<string, unknown> => t !== null);

  return {
    ...(systemParts.filter(Boolean).length ? { system: systemParts.filter(Boolean).join('\n\n') } : {}),
    messages,
    ...(tools && tools.length ? { tools } : {}),
    ...(tools && tools.length && 'tool_choice' in extra ? { tool_choice: toAnthropicToolChoice(extra.tool_choice) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Anthropic Messages  →  OpenAI chat-completion  (response translation)
// ---------------------------------------------------------------------------

/** Map an Anthropic `stop_reason` to an OpenAI `finish_reason`. */
function mapStopReason(stop: unknown): string {
  switch (stop) {
    case 'tool_use': return 'tool_calls';
    case 'max_tokens': return 'length';
    default: return 'stop'; // end_turn | stop_sequence | refusal | null
  }
}

/** Build an OpenAI chat-completion object from an Anthropic Messages response, so
 *  the rest of the gateway (parser, empty-200 guard, cloud loop, SDK) is unchanged. */
function toOpenAIResponse(raw: unknown, model: string): Record<string, unknown> {
  const r = raw as { id?: string; content?: unknown[]; stop_reason?: unknown; usage?: Record<string, unknown> } | null;
  const blocks = Array.isArray(r?.content) ? r!.content : [];
  let text = '';
  const toolCalls: Array<Record<string, unknown>> = [];
  for (const bRaw of blocks) {
    const b = bRaw as { type?: string; text?: string; id?: string; name?: string; input?: unknown };
    if (b?.type === 'text' && typeof b.text === 'string') text += b.text;
    else if (b?.type === 'tool_use') {
      toolCalls.push({ id: b.id ?? '', type: 'function', function: { name: b.name ?? '', arguments: JSON.stringify(b.input ?? {}) } });
    }
  }
  const u = r?.usage ?? {};
  const inTok = Number(u['input_tokens'] ?? 0) || 0;
  const outTok = Number(u['output_tokens'] ?? 0) || 0;
  const message: Record<string, unknown> = { role: 'assistant', content: text || (toolCalls.length ? null : '') };
  if (toolCalls.length) message.tool_calls = toolCalls;
  return {
    id: r?.id ?? 'anthropic-direct',
    object: 'chat.completion',
    model,
    choices: [{ index: 0, message, finish_reason: mapStopReason(r?.stop_reason) }],
    usage: {
      prompt_tokens: inTok,
      completion_tokens: outTok,
      total_tokens: inTok + outTok,
      ...(u['cache_read_input_tokens'] != null ? { cache_read_input_tokens: u['cache_read_input_tokens'] } : {}),
      ...(u['cache_creation_input_tokens'] != null ? { cache_creation_input_tokens: u['cache_creation_input_tokens'] } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Vendor module
// ---------------------------------------------------------------------------

/**
 * Build the Anthropic Messages request (headers + body) shared by `call` (non-stream)
 * and `callStream`. `stream` flips the `stream: true` flag; everything else — the OAuth
 * vs api-key auth, the Claude-Code identity system block OAuth requires, prompt caching
 * on the stable prefix, thinking disabled, structured-output passthrough — is identical,
 * so the two surfaces can never drift on request shape.
 */
function prepareAnthropicRequest(
  params: VendorCallParams,
  stream: boolean,
): { headers: Record<string, string>; body: Record<string, unknown>; isOAuth: boolean } {
  const req = toAnthropicRequest(params);
  // Subscription (OAuth) vs API key: decode the sentinel `apiKeyFrom` encoded.
  const isOAuth = params.apiKey.startsWith(OAUTH_APIKEY_PREFIX);
  // TRIM the credential: an OAuth access token or api key that carries a stray
  // newline / trailing whitespace (e.g. from a copy-paste or an over-eager store)
  // makes `fetch()` throw `TypeError: invalid header value` SYNCHRONOUSLY — which the
  // cascade records as a `code: 0` "network" failure with no HTTP status, the exact
  // mystifying "connected account errored (no response)" symptom. Trimming kills that
  // class outright; an empty credential is surfaced as a clear auth error below.
  const credential = (isOAuth ? params.apiKey.slice(OAUTH_APIKEY_PREFIX.length) : params.apiKey).trim();
  if (!credential) {
    throw new VendorRetryableError(
      'anthropic',
      params.model,
      401,
      isOAuth
        ? 'connected Claude subscription token is empty — reconnect it in Settings ▸ API Keys'
        : 'CLAUDE_API_KEY is empty',
    );
  }
  const maxTokens = Math.min(Math.max(1, params.maxTokens ?? DEFAULT_MAX_TOKENS), MAX_OUTPUT_TOKENS);
  // Cache the large STABLE prefix (tools + system instructions/repo context) so a
  // multi-turn run pays ~0.1x for it after the first turn. `{type:'ephemeral'}` is the
  // GA 5-minute cache. A SUBSCRIPTION (OAuth) token REQUIRES the Claude Code identity as
  // the first system block — Anthropic 401s an OAuth Messages call without it.
  const CACHE = { type: 'ephemeral' as const };
  const systemBlocks: Array<Record<string, unknown>> = [];
  if (isOAuth) systemBlocks.push({ type: 'text', text: CLAUDE_CODE_SYSTEM_PROMPT });
  if (req.system) systemBlocks.push({ type: 'text', text: req.system, cache_control: CACHE });
  const system = systemBlocks.length ? systemBlocks : undefined;
  const tools = req.tools && req.tools.length
    ? req.tools.map((t, i) => (i === req.tools!.length - 1 ? { ...t, cache_control: CACHE } : t))
    : undefined;
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: maxTokens,
    messages: req.messages,
    ...(system ? { system } : {}),
    ...(tools ? { tools } : {}),
    ...(req.tool_choice ? { tool_choice: req.tool_choice } : {}),
    // Extended thinking OFF: the gateway round-trips assistant turns through the OpenAI
    // shape, which can't carry `thinking` blocks; both catalog models accept disabled.
    thinking: { type: 'disabled' },
    ...(stream ? { stream: true } : {}),
  };
  const rf = (params.extraBody ?? {}).response_format as { type?: string; json_schema?: { schema?: unknown } } | undefined;
  if (rf?.type === 'json_schema' && rf.json_schema?.schema) {
    body.output_config = { format: { type: 'json_schema', schema: rf.json_schema.schema } };
  }
  const headers: Record<string, string> = {
    // Subscription tokens use Bearer + the oauth beta; API keys use x-api-key.
    ...(isOAuth
      ? { authorization: `Bearer ${credential}`, 'anthropic-beta': ANTHROPIC_OAUTH_BETA }
      : { 'x-api-key': credential }),
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
  };
  return { headers, body, isOAuth };
}

/** Classify a non-OK Anthropic HTTP response into the cascade's error taxonomy — shared
 *  by `call` + `callStream` so both surfaces fail over identically. Always throws. */
async function throwAnthropicHttpError(resp: Response, model: string, isOAuth: boolean): Promise<never> {
  const errText = (await resp.text()).slice(0, 400);
  if (resp.status === OVERLOADED_STATUS || CASCADE_STATUSES.has(resp.status)) {
    throw new VendorRetryableError('anthropic', model, resp.status, errText.slice(0, 240));
  }
  if (AUTH_STATUSES.has(resp.status)) {
    console.error(
      `[vendors] anthropic/${model} auth ${resp.status} — ${isOAuth ? 'tenant Claude subscription token rejected (expired/revoked — reconnect)' : 'check CLAUDE_API_KEY'}. Failing over to next model.`,
      errText.slice(0, 200),
    );
    throw new VendorRetryableError('anthropic', model, resp.status, `auth ${resp.status}: ${errText.slice(0, 200)}`);
  }
  // 400/422 (and other 4xx) fatal — the dispatcher advances past them — UNLESS the 400
  // is a usage-cap / credit-balance limit (Anthropic returns those as 400s), which is a
  // capacity condition another vendor can serve: fail over + cool instead of dying.
  throwClassified4xx('anthropic', model, resp.status, errText);
}

// ---------------------------------------------------------------------------
// Streaming translation: Anthropic Messages SSE → OpenAI chat.completion.chunk SSE
// ---------------------------------------------------------------------------

/** Cross-event streaming state (mutated as events arrive). */
export interface AnthropicStreamState {
  id: string;
  model: string;
  sentRole: boolean;
  toolIdxByBlock: Map<number, number>;
  nextToolIdx: number;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
}

export function newAnthropicStreamState(model: string): AnthropicStreamState {
  return {
    id: 'chatcmpl-anthropic', model, sentRole: false,
    toolIdxByBlock: new Map(), nextToolIdx: 0, finishReason: 'stop',
    inputTokens: 0, outputTokens: 0,
  };
}

/**
 * Translate ONE Anthropic Messages SSE event → zero or more OpenAI
 * `chat.completion.chunk` objects, mutating `st` for cross-event bookkeeping (role
 * once, tool-block → tool_calls index, stop reason, token usage). Pure and
 * unit-tested (`anthropic.stream.test.ts`) so the streaming translation is verified
 * without a live Anthropic endpoint. Mapping:
 *   message_start            → capture input tokens
 *   content_block_start(tool)→ tool_calls delta {index,id,name,arguments:''}
 *   content_block_delta      → text_delta → {content}; input_json_delta → {tool_calls[].function.arguments}
 *   message_delta            → capture stop_reason + output tokens
 *   message_stop             → final finish_reason chunk + a usage-only chunk
 */
export function anthropicEventToOpenAiChunks(
  ev: Record<string, unknown>,
  st: AnthropicStreamState,
): Array<Record<string, unknown>> {
  const type = ev?.type as string | undefined;
  const out: Array<Record<string, unknown>> = [];
  const mk = (delta: Record<string, unknown>, finish: string | null = null): Record<string, unknown> => {
    const d = st.sentRole ? delta : { role: 'assistant', ...delta };
    st.sentRole = true;
    return { id: st.id, object: 'chat.completion.chunk', model: st.model, choices: [{ index: 0, delta: d, finish_reason: finish }] };
  };
  switch (type) {
    case 'message_start': {
      const usage = (ev.message as { usage?: { input_tokens?: number } } | undefined)?.usage;
      if (usage?.input_tokens != null) st.inputTokens = usage.input_tokens;
      break;
    }
    case 'content_block_start': {
      const cb = ev.content_block as { type?: string; id?: string; name?: string } | undefined;
      if (cb?.type === 'tool_use') {
        const oi = st.nextToolIdx++;
        st.toolIdxByBlock.set(ev.index as number, oi);
        out.push(mk({ tool_calls: [{ index: oi, id: cb.id ?? '', type: 'function', function: { name: cb.name ?? '', arguments: '' } }] }));
      }
      break;
    }
    case 'content_block_delta': {
      const delta = ev.delta as { type?: string; text?: string; partial_json?: string } | undefined;
      if (delta?.type === 'text_delta' && delta.text) {
        out.push(mk({ content: delta.text }));
      } else if (delta?.type === 'input_json_delta') {
        const oi = st.toolIdxByBlock.get(ev.index as number) ?? 0;
        out.push(mk({ tool_calls: [{ index: oi, function: { arguments: delta.partial_json ?? '' } }] }));
      }
      break;
    }
    case 'message_delta': {
      const delta = ev.delta as { stop_reason?: unknown } | undefined;
      if (delta?.stop_reason) st.finishReason = mapStopReason(delta.stop_reason);
      const usage = ev.usage as { output_tokens?: number } | undefined;
      if (usage?.output_tokens != null) st.outputTokens = usage.output_tokens;
      break;
    }
    case 'message_stop': {
      out.push(mk({}, st.finishReason));
      out.push({ id: st.id, object: 'chat.completion.chunk', model: st.model, choices: [], usage: { prompt_tokens: st.inputTokens, completion_tokens: st.outputTokens, total_tokens: st.inputTokens + st.outputTokens } });
      break;
    }
    // 'ping' / 'content_block_stop' → nothing; 'error' handled by the wrapper.
  }
  return out;
}

/** Wrap an Anthropic SSE body in a ReadableStream that emits OpenAI SSE frames. */
function streamAnthropicToOpenAi(body: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  const state = newAnthropicStreamState(model);
  let buffer = '';
  const frame = (obj: Record<string, unknown>) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let emitted = false;
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>; } catch { continue; }
          if ((ev.type as string) === 'error') {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return;
          }
          for (const chunk of anthropicEventToOpenAiChunks(ev, state)) {
            controller.enqueue(frame(chunk));
            emitted = true;
          }
        }
        if (emitted) return; // yield to the consumer; pull() is called again for more
      }
    },
    cancel() { reader.cancel().catch(() => { /* ignore */ }); },
  });
}

export const anthropicModule: VendorModule = {
  id: 'anthropic',
  catalog: CATALOG,
  tierFor: tierForAnthropicModel,
  autoRoute: false, // floor-only: never auto-selected; reached via the coding fallback chain, an explicit pin, or a tenant's connected-BYO seed.
  // Prefer a connected tenant SUBSCRIPTION (OAuth) over the operator's metered API
  // key — a tenant's own subscription is free to us, so when present it wins. The
  // `oauth:` sentinel tells `call`/`callStream` which auth header to use (never sees env).
  apiKeyFrom(env) {
    if (env.CLAUDE_OAUTH_TOKEN) return `${OAUTH_APIKEY_PREFIX}${env.CLAUDE_OAUTH_TOKEN}`;
    return env.CLAUDE_API_KEY ?? null;
  },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    const { headers, body, isOAuth } = prepareAnthropicRequest(params, false);
    const resp = await fetchWithVendorTimeout('anthropic', params.model, ENDPOINT, {
      method: 'POST', headers, body: JSON.stringify(body),
    }, params.timeoutMs, params.signal);
    if (resp.ok) {
      const raw = await resp.json();
      const oai = toOpenAIResponse(raw, params.model);
      const parsed = parseOpenAIResponse(oai);
      return { raw: oai, content: parsed.content, ...(parsed.usage ? { usage: parsed.usage } : {}) };
    }
    return throwAnthropicHttpError(resp, params.model, isOAuth);
  },
  async callStream(params: VendorCallParams): Promise<VendorStreamResult> {
    const { headers, body, isOAuth } = prepareAnthropicRequest(params, true);
    const resp = await fetchWithVendorTimeout('anthropic', params.model, ENDPOINT, {
      method: 'POST', headers, body: JSON.stringify(body),
    }, params.timeoutMs, params.signal);
    if (!resp.ok) return throwAnthropicHttpError(resp, params.model, isOAuth);
    if (!resp.body) throw new VendorRetryableError('anthropic', params.model, 0, 'empty stream body');
    return {
      response: new Response(streamAnthropicToOpenAi(resp.body, params.model), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      }),
    };
  },
};
