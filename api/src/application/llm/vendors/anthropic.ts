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
 * Streaming is intentionally NOT implemented (`callStream` omitted): the only path
 * that reaches this vendor — the cloud coding tool loop — is non-streaming, so the
 * streaming dispatcher cleanly skips Anthropic. See the Consolidated Gap Register.
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
} from './types';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
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

export const anthropicModule: VendorModule = {
  id: 'anthropic',
  catalog: CATALOG,
  tierFor: tierForAnthropicModel,
  autoRoute: false, // floor-only: never auto-selected; reached via the coding fallback chain or an explicit pin.
  apiKeyFrom(env) { return env.CLAUDE_API_KEY ?? null; },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    const req = toAnthropicRequest(params);
    const maxTokens = Math.min(Math.max(1, params.maxTokens ?? DEFAULT_MAX_TOKENS), MAX_OUTPUT_TOKENS);
    // Cache the large STABLE prefix (tools + system instructions/repo context) so a
    // multi-turn coding run pays ~0.1x for it after the first turn instead of full
    // price on the METERED key. `{type:'ephemeral'}` is the GA 5-minute cache (no beta
    // header); turns are seconds apart so it stays warm. Marking the system block (and
    // the last tool) caches everything up to and including them. Sub-1024-token
    // prefixes are silently ignored by Anthropic, so this is safe for tiny requests.
    const CACHE = { type: 'ephemeral' as const };
    const system = req.system ? [{ type: 'text', text: req.system, cache_control: CACHE }] : undefined;
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
      // Extended thinking is OFF on purpose. The gateway round-trips assistant
      // turns through the OpenAI shape, which cannot carry Anthropic `thinking`
      // blocks — replaying a tool-use turn without its thinking block 400s. Both
      // catalog models accept `{type:'disabled'}`; keeping thinking off makes the
      // multi-turn tool loop valid. (Sampling params are intentionally dropped:
      // claude-opus-4-8 rejects temperature/top_p, and the coding loop doesn't set them.)
      thinking: { type: 'disabled' },
    };
    // Best-effort structured-output passthrough: map a strict json_schema request
    // to Anthropic's output_config. json_object (no schema) has no direct
    // equivalent and is left to the gateway's conformance retry to handle.
    const rf = (params.extraBody ?? {}).response_format as { type?: string; json_schema?: { schema?: unknown } } | undefined;
    if (rf?.type === 'json_schema' && rf.json_schema?.schema) {
      body.output_config = { format: { type: 'json_schema', schema: rf.json_schema.schema } };
    }

    const resp = await fetchWithVendorTimeout('anthropic', params.model, ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': params.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }, params.timeoutMs, params.signal);

    if (resp.ok) {
      const raw = await resp.json();
      const oai = toOpenAIResponse(raw, params.model);
      const parsed = parseOpenAIResponse(oai);
      return { raw: oai, content: parsed.content, ...(parsed.usage ? { usage: parsed.usage } : {}) };
    }

    const errText = (await resp.text()).slice(0, 400);
    if (resp.status === OVERLOADED_STATUS || CASCADE_STATUSES.has(resp.status)) {
      throw new VendorRetryableError('anthropic', params.model, resp.status, errText.slice(0, 240));
    }
    if (AUTH_STATUSES.has(resp.status)) {
      console.error(
        `[vendors] anthropic/${params.model} auth ${resp.status} — check CLAUDE_API_KEY. Failing over to next model.`,
        errText.slice(0, 200),
      );
      throw new VendorRetryableError('anthropic', params.model, resp.status, `auth ${resp.status}: ${errText.slice(0, 200)}`);
    }
    // 400/422 (and other 4xx) are surfaced as fatal — the dispatcher advances past
    // a 400/422 to the next candidate rather than hard-failing the whole cascade —
    // UNLESS the 400 is actually a usage-cap / credit-balance limit (Anthropic
    // returns these as `invalid_request_error` 400s), in which case it's a
    // capacity condition that another vendor can serve: fail over AND cool the
    // vendor instead of dying with a misleading 400.
    throwClassified4xx('anthropic', params.model, resp.status, errText);
  },
};
