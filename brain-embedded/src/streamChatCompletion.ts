/**
 * The single tool-capable, streaming chat-completion client for the Brain.
 *
 * Targets the OpenAI-compatible gateway `POST {baseUrl}/llm/v1/chat/completions`
 * with `stream: true`, forwards `tools`/`tool_choice`, and surfaces BOTH text
 * deltas and `tool_calls` deltas to the caller.
 *
 * Unlike the in-app original, auth and error mapping are injected via a
 * `BrainTransport` (baseUrl + getToken + onUnauthorized + mapError) so the same
 * client works for builderforce.ai (tenant JWT) and external embeds (a
 * short-lived relay token) without importing any app code.
 *
 * Tool names are kept flat snake_case by convention (no dots), so the gateway's
 * tool-name sanitizer is a no-op and streamed `tool_calls` names round-trip
 * unchanged.
 *
 * Some models emit tool calls inline in the *text* stream as `<tool_call>…`
 * markup instead of native `tool_calls` deltas. {@link XmlToolCallFilter} lifts
 * those into the same structured shape (so they actually execute) and strips the
 * markup from the visible text — see `xmlToolCalls.ts`.
 */

import { XmlToolCallFilter, extractXmlToolCalls } from './xmlToolCalls';

/** Injected auth + endpoint config. Built once by BrainProvider from BrainConfig.transport. */
export interface BrainTransport {
  /** Gateway base URL, e.g. https://api.builderforce.ai (no trailing slash). */
  baseUrl: string;
  /** Returns the current bearer token (tenant JWT or embed relay token), or null. */
  getToken: () => string | null;
  /** Called on a 401 so the host can clear the session / redirect. */
  onUnauthorized?: (res: Response, hadToken: boolean) => void;
  /** Map a non-OK response to a typed Error (e.g. plan-limit handling). */
  mapError?: (res: Response) => Promise<Error>;
  /** Default model when a call doesn't specify one. */
  defaultModel?: string;
  /**
   * Optional networking override. When set, the streaming request is performed
   * through this instead of the global `fetch`. It MUST resolve to a `Response`
   * whose `body` is a readable stream of the raw SSE bytes (same contract as
   * `fetch`). Hosts that can't reach the gateway directly from the UI context
   * (e.g. a VS Code webview, where a `vscode-webview://` origin is CORS-blocked)
   * inject a fetch that proxies the call through their privileged side. Defaults
   * to the global `fetch` for the browser/web app.
   */
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

/** OpenAI function-tool spec (the `tools[]` entries sent to the model). */
export interface BrainToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    /** JSON Schema for the function arguments. */
    parameters: Record<string, unknown>;
  };
}

/** A plain-text content part (OpenAI multimodal `content[]` shape). */
export interface TextContentPart {
  type: 'text';
  text: string;
}

/**
 * An image content part. `url` is either a `data:` URI (inlined, the common
 * case after client-side downscaling) or a short-lived signed public URL the
 * upstream provider can fetch. The gateway's shape router detects these and
 * floats a vision-capable model to the head of the cascade.
 */
export interface ImageUrlContentPart {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
}

export type ContentPart = TextContentPart | ImageUrlContentPart;

/** A message in the working array — supports assistant tool-call turns and tool results. */
export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /**
   * Plain string for the overwhelming majority of turns. A `ContentPart[]` is
   * used only when a user turn carries images (vision): the gateway forwards
   * the array untouched and routes to a vision model. Persistence stays
   * text-only — the rich array lives in the in-memory transcript so the model
   * keeps seeing the image on later turns.
   */
  content: string | ContentPart[];
  /** Present on an assistant turn that requested tools. */
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  /** Present on a tool-result message, linking it to the call. */
  tool_call_id?: string;
}

export interface StreamHandlers {
  onTextDelta?(delta: string): void;
  /** Fired per streamed tool-call fragment; accumulate by `index`. */
  onToolCallDelta?(index: number, partial: { id?: string; name?: string; argsFragment?: string }): void;
  onDone?(finishReason: string | null): void;
}

export interface StreamChatOptions {
  messages: ChatCompletionMessage[];
  tools?: BrainToolSpec[];
  tool_choice?: 'auto' | 'none';
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Auth + endpoint. Injected by BrainProvider; callers via the hook never set this directly. */
  transport: BrainTransport;
}

/** A fully-stitched tool call assembled from streamed deltas. */
export interface AssembledToolCall {
  id: string;
  name: string;
  /** Raw JSON argument string (parse with `JSON.parse`). */
  args: string;
}

/**
 * Token accounting for one completion, as reported by the gateway's final
 * `usage` chunk (OpenAI shape). Absent when the upstream didn't emit usage
 * (some providers don't). Surfaced so the triage/diagnostics layer can tell a
 * CONTEXT-EXHAUSTION death (prompt tokens climbing turn over turn until the
 * model 413s / truncates) apart from a model-DEGRADATION death (an Evermind/SSM
 * turn returning empty or garbage while token counts stay low).
 */
export interface CompletionUsage {
  prompt?: number;
  completion?: number;
  total?: number;
}

export interface StreamChatResult {
  text: string;
  toolCalls: AssembledToolCall[];
  finishReason: string | null;
  /**
   * The model the GATEWAY actually used for this completion — which can differ
   * from the requested `model` (empty/absent means the gateway auto-selected
   * from its pool, and failover may have swapped upstreams mid-cascade). Sourced
   * from the `x-builderforce-model` response header when readable, else from the
   * `model` field the OpenAI-shaped stream chunks carry. Surfaced so callers can
   * record which LLM (or which `evermind/…` artifact) produced a turn.
   */
  resolvedModel?: string;
  /**
   * Which account served this turn, from the gateway's `x-builderforce-account`
   * response header: `own` (the tenant's connected frontier account), `shared`
   * (the shared pool, no connected account), or `shared_byo_unused` (the shared
   * pool despite a connected account existing). Undefined when the gateway didn't
   * report one (older gateway, or the header wasn't CORS-exposed). Feeds the
   * per-reply provenance chip so a successful turn shows whose account ran it.
   */
  account?: string;
  /** Token usage for this completion, when the gateway reported it. */
  usage?: CompletionUsage;
}

interface DeltaToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** Minimal default error mapper used when the transport doesn't supply one. */
async function defaultMapError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown; message?: unknown };
  const msg =
    (typeof body.error === 'string' && body.error) ||
    (typeof body.message === 'string' && body.message) ||
    res.statusText ||
    `Request failed (${res.status})`;
  return new Error(msg);
}

/**
 * Stream a chat completion. Resolves once the stream ends with the stitched
 * final text and any tool calls the model requested.
 */
export async function streamChatCompletion(
  opts: StreamChatOptions,
  handlers: StreamHandlers = {},
): Promise<StreamChatResult> {
  const { transport } = opts;
  const token = transport.getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const body: Record<string, unknown> = {
    model: opts.model ?? transport.defaultModel ?? 'openai/gpt-4o-mini',
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 4096,
    stream: true,
    // Ask the gateway to emit a trailing `usage` chunk (OpenAI stream_options).
    // Providers that ignore it simply omit usage — the parse below is tolerant.
    stream_options: { include_usage: true },
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = opts.tool_choice ?? 'auto';
  }

  const doFetch = transport.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const res = await doFetch(`${transport.baseUrl}/llm/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (res.status === 401) transport.onUnauthorized?.(res, !!token);
  if (!res.ok) throw await (transport.mapError ?? defaultMapError)(res);

  // The gateway echoes the model it actually routed to in this header. Readable
  // same-origin and cross-origin only when CORS-exposed; the per-chunk `model`
  // field below is the always-readable fallback. Header wins when both present.
  let headerModel: string | null = null;
  try { headerModel = res.headers?.get?.('x-builderforce-model') || null; } catch { headerModel = null; }
  let streamModel: string | null = null;
  const resolvedModel = (): string | undefined => headerModel ?? streamModel ?? undefined;
  // The account that served this turn (own / shared / shared_byo_unused) — set by
  // the gateway and readable cross-origin only when CORS-exposed (it is). Powers
  // the provenance chip; absent gracefully degrades to no chip.
  let headerAccount: string | null = null;
  try { headerAccount = res.headers?.get?.('x-builderforce-account') || null; } catch { headerAccount = null; }
  const account = (): string | undefined => headerAccount ?? undefined;

  // Token usage from the trailing `usage` chunk (or a non-streaming body). Kept
  // as the last non-empty usage seen so a mid-stream partial can't clobber the
  // final totals.
  let usage: CompletionUsage | undefined;
  const readUsage = (u: unknown): void => {
    if (!u || typeof u !== 'object') return;
    const o = u as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
    const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
    const next: CompletionUsage = { prompt: num(o.prompt_tokens), completion: num(o.completion_tokens), total: num(o.total_tokens) };
    if (next.prompt != null || next.completion != null || next.total != null) usage = next;
  };

  // Tool calls are accumulated by index across deltas.
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  // Lifts inline `<tool_call>…` markup out of the text stream into structured
  // calls and yields only clean text for display.
  const xml = new XmlToolCallFilter();
  let finishReason: string | null = null;

  /** Stitch the native + inline-XML tool calls; native first, XML as fallback. */
  const allToolCalls = (): AssembledToolCall[] => [...assemble(toolAcc), ...xml.toolCalls()];

  const reader = res.body?.getReader();
  if (!reader) {
    // Non-streaming fallback: some gateways may ignore `stream` and return JSON.
    const data = (await res.json().catch(() => null)) as
      | { model?: string; choices?: Array<{ message?: { content?: string; tool_calls?: DeltaToolCall[] }; finish_reason?: string }> }
      | null;
    if (typeof data?.model === 'string' && data.model) streamModel = data.model;
    readUsage((data as { usage?: unknown } | null)?.usage);
    const choice = data?.choices?.[0];
    const { text, toolCalls: xmlCalls } = extractXmlToolCalls(choice?.message?.content ?? '');
    if (text) handlers.onTextDelta?.(text);
    (choice?.message?.tool_calls ?? []).forEach((tc, i) => {
      const idx = tc.index ?? i;
      toolAcc.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', args: tc.function?.arguments ?? '' });
    });
    finishReason = choice?.finish_reason ?? null;
    handlers.onDone?.(finishReason);
    return { text, toolCalls: [...assemble(toolAcc), ...xmlCalls], finishReason, resolvedModel: resolvedModel(), account: account(), usage };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6).trim();
      if (payload === '[DONE]') {
        const tail = xml.flush();
        if (tail) handlers.onTextDelta?.(tail);
        handlers.onDone?.(finishReason);
        return { text: xml.cleanText(), toolCalls: allToolCalls(), finishReason, resolvedModel: resolvedModel(), account: account(), usage };
      }
      let parsed: {
        model?: string;
        usage?: unknown;
        choices?: Array<{
          delta?: { content?: string; tool_calls?: DeltaToolCall[] };
          finish_reason?: string | null;
        }>;
        // Non-OpenAI fallbacks some providers emit:
        response?: string;
        text?: string;
        delta?: string;
      };
      try {
        parsed = JSON.parse(payload);
      } catch {
        // Never surface raw JSON; skip malformed chunks.
        continue;
      }
      if (!streamModel && typeof parsed.model === 'string' && parsed.model) streamModel = parsed.model;
      // The usage-bearing chunk (OpenAI stream_options) typically arrives last,
      // often with an empty `choices` array — read it whenever present.
      if (parsed.usage) readUsage(parsed.usage);
      const choice = parsed.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;

      const contentDelta =
        (typeof choice?.delta?.content === 'string' ? choice.delta.content : null) ||
        parsed.response ||
        parsed.text ||
        parsed.delta ||
        '';
      if (contentDelta) {
        const visible = xml.push(contentDelta);
        if (visible) handlers.onTextDelta?.(visible);
      }

      const tcDeltas = choice?.delta?.tool_calls;
      if (tcDeltas) {
        for (let i = 0; i < tcDeltas.length; i++) {
          const d = tcDeltas[i];
          const idx = d.index ?? i;
          const cur = toolAcc.get(idx) ?? { id: '', name: '', args: '' };
          if (d.id) cur.id = d.id;
          if (d.function?.name) cur.name = d.function.name;
          if (d.function?.arguments) cur.args += d.function.arguments;
          toolAcc.set(idx, cur);
          handlers.onToolCallDelta?.(idx, {
            id: d.id,
            name: d.function?.name,
            argsFragment: d.function?.arguments,
          });
        }
      }
    }
  }

  const tail = xml.flush();
  if (tail) handlers.onTextDelta?.(tail);
  handlers.onDone?.(finishReason);
  return { text: xml.cleanText(), toolCalls: allToolCalls(), finishReason, resolvedModel: resolvedModel(), account: account(), usage };
}

function assemble(acc: Map<number, { id: string; name: string; args: string }>): AssembledToolCall[] {
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({ id: v.id, name: v.name, args: v.args }))
    .filter((c) => c.name.length > 0);
}
