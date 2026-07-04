/**
 * Bidirectional tool-call sanitizer — the SINGLE place the gateway makes
 * OpenAI-shape tool calls safe for strict vendors. It normalizes two fields
 * that vendors like Anthropic validate against `^[a-zA-Z0-9_-]+$`:
 *
 *  1. Tool NAMES (`tools[].function.name`, `tool_calls[].function.name`, …).
 *     Tenant apps use dotted namespaces (`governance.snapshot`,
 *     `agile.kanban.list`); the vendor rejects the dot. Names are REVERSIBLE —
 *     the caller expects their dotted namespace back — so we map dots through a
 *     sentinel (`__DOT__`) on the request path and restore on the response path.
 *     The sentinel is vanishingly unlikely in a real name; if it ever occurs the
 *     round-trip preserves it by escaping `__DOT__` itself.
 *
 *  2. Tool-call IDs (`tool_calls[].id`, `role:'tool'` `tool_call_id`). The whole
 *     gateway speaks OpenAI shape and fails over across many vendors in one run
 *     (minimax, `@cf/*` Workers AI, OpenRouter coders, the Anthropic floor, …).
 *     Non-Anthropic providers mint ids containing `:`, `/`, `.`, etc.; OpenAI-
 *     compat vendors accept them but Anthropic 400s (`tool_use.id: String should
 *     match pattern …`) when the cascade later falls over INTO it carrying that
 *     history. Ids are opaque correlation tokens, NOT shown to the caller, so —
 *     unlike names — they are deterministically rewritten on the request path and
 *     NEVER restored: the vendor mints fresh (already-valid) ids in its reply, and
 *     re-sanitizing an already-valid id is a no-op, so the `tool_use ↔ tool_result`
 *     pairing holds every turn with no lookup map.
 *
 * Both are applied uniformly across vendors — even those that accept the raw
 * alphabet — so the mapping is symmetric and cooldown/failover never sees a mixed
 * alphabet across the candidate chain.
 */

import { parseSseDataLine } from './sseFrames';

const DOT_SENTINEL    = '__DOT__';
const ESCAPE_SENTINEL = '__DOT_ESC__';

const VALID_TOOL_CALL_ID = /^[a-zA-Z0-9_-]+$/;

export function sanitizeToolName(name: string): string {
  // Escape any pre-existing sentinel first, then replace dots.
  return name.replace(new RegExp(DOT_SENTINEL, 'g'), ESCAPE_SENTINEL).replace(/\./g, DOT_SENTINEL);
}

export function restoreToolName(name: string): string {
  // Restore in reverse order of escape.
  return name.replace(new RegExp(DOT_SENTINEL, 'g'), '.').replace(new RegExp(ESCAPE_SENTINEL, 'g'), DOT_SENTINEL);
}

/**
 * Rewrite a tool-call id to the `^[a-zA-Z0-9_-]+$` charset. PURE and deterministic
 * so a `tool_use` and its paired `tool_result` (which carries the identical id)
 * map to the same output — pairing is preserved with no lookup table. Already-valid
 * ids pass through untouched (so this is idempotent across failover turns); when a
 * rewrite is needed a short FNV-1a hash of the original is appended so two distinct
 * foreign ids that collapse to the same characters can't collide into a duplicate.
 */
export function sanitizeToolCallId(id: string): string {
  if (id.length > 0 && VALID_TOOL_CALL_ID.test(id)) return id;
  let hash = 0x811c9dc5; // FNV-1a (32-bit) — dependency-free, stable per id.
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const suffix = (hash >>> 0).toString(36);
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return safe.length > 0 ? `${safe}_${suffix}` : `toolu_${suffix}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Walkers — apply the (de)sanitizer to every tool-name location in the
// OpenAI-shape request/response. Single source so no caller needs to know
// which fields carry tool names.
// ─────────────────────────────────────────────────────────────────────────────

interface MaybeFunctionCarrier {
  type?: string;
  id?: string;
  function?: { name?: string; [k: string]: unknown };
  [k: string]: unknown;
}

interface MaybeMessage {
  role?: string;
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<MaybeFunctionCarrier>;
  [k: string]: unknown;
}

/**
 * Sanitize tool NAMES and tool-call IDs in a request body before vendor dispatch.
 * The single request-path pass for making OpenAI-shape tool calls vendor-safe.
 */
export function sanitizeRequestToolCalls(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };

  if (Array.isArray(body.tools)) {
    out.tools = (body.tools as MaybeFunctionCarrier[]).map((t) => {
      if (t?.function?.name) {
        return { ...t, function: { ...t.function, name: sanitizeToolName(t.function.name) } };
      }
      return t;
    });
  }

  const tc = body.tool_choice as MaybeFunctionCarrier | string | undefined;
  if (tc && typeof tc !== 'string' && tc.function?.name) {
    out.tool_choice = { ...tc, function: { ...tc.function, name: sanitizeToolName(tc.function.name) } };
  }

  // Sanitize tool-call names AND ids already in the conversation history: assistant
  // tool-call turns (`function.name` + `id`) and `role: 'tool'` result turns
  // (`name` + `tool_call_id`). The id rewrite is deterministic, so an assistant
  // `tool_calls[].id` and the `tool_call_id` on the matching tool result map
  // identically and stay paired for strict vendors (Anthropic).
  if (Array.isArray(body.messages)) {
    out.messages = (body.messages as MaybeMessage[]).map((m) => {
      const next: MaybeMessage = { ...m };
      if (Array.isArray(m.tool_calls)) {
        next.tool_calls = m.tool_calls.map((call) => {
          let mapped = call;
          if (call?.function?.name) {
            mapped = { ...mapped, function: { ...mapped.function, name: sanitizeToolName(call.function.name) } };
          }
          if (typeof call?.id === 'string') {
            mapped = { ...mapped, id: sanitizeToolCallId(call.id) };
          }
          return mapped;
        });
      }
      if (m.role === 'tool') {
        if (typeof m.name === 'string') next.name = sanitizeToolName(m.name);
        if (typeof m.tool_call_id === 'string') next.tool_call_id = sanitizeToolCallId(m.tool_call_id);
      }
      return next;
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming restore — vendor SSE chunks carry tool-call function names in
// `choices[*].delta.tool_calls[*].function.name`, and the name can arrive in
// fragments across deltas (the sanitized form `governance__DOT__snapshot` may
// even split mid-sentinel). The non-streaming `restoreResponseToolNames` can't
// see this because it only runs on a fully-assembled JSON body. This buffers
// the accumulated name per (choice index, tool-call index) and re-emits only
// the newly-revealed restored tail on each delta, so the stream stays
// incremental while the caller still sees their dotted namespace.
// ─────────────────────────────────────────────────────────────────────────────

interface ToolCallDelta {
  index?: number;
  function?: { name?: string; arguments?: string; [k: string]: unknown };
  [k: string]: unknown;
}

/**
 * Length of the longest suffix of `s` that is a *proper* prefix of a sentinel
 * (could still grow into a `.` or an escaped sentinel as more bytes arrive).
 * A complete sentinel is NOT unsafe — it restores deterministically — so we
 * only hold back genuinely incomplete trailing sentinels.
 */
function unsafeSuffixLen(s: string): number {
  // Longest sentinel governs how far back we must look.
  const max = Math.min(s.length, ESCAPE_SENTINEL.length - 1);
  for (let len = max; len > 0; len--) {
    const suffix = s.slice(s.length - len);
    if (DOT_SENTINEL.startsWith(suffix) && suffix !== DOT_SENTINEL) return len;
    if (ESCAPE_SENTINEL.startsWith(suffix) && suffix !== ESCAPE_SENTINEL) return len;
  }
  return 0;
}

interface StreamChoiceDelta {
  index?: number;
  delta?: { tool_calls?: ToolCallDelta[]; [k: string]: unknown };
  [k: string]: unknown;
}

/**
 * Stateful restorer for streamed tool-call name deltas. One instance per stream.
 *
 * For each tool call we track the raw (sanitized) name accumulated so far and
 * how much of the *restored* name we've already emitted. On every delta we
 * restore the accumulated raw name up to the last unambiguous boundary (holding
 * back any trailing partial sentinel) and emit only the newly-revealed tail, so
 * a sentinel split across two fragments still restores correctly and the caller
 * receives exactly the new restored characters.
 */
export class StreamingToolNameRestorer {
  // key = `${choiceIndex}:${toolCallIndex}`
  private readonly rawSoFar = new Map<string, string>();
  private readonly emittedLen = new Map<string, number>();

  /** Mutate one parsed SSE chunk in place, restoring any tool-call name fragments. */
  restoreChunk(chunk: Record<string, unknown>): void {
    const choices = chunk.choices as StreamChoiceDelta[] | undefined;
    if (!Array.isArray(choices)) return;
    for (let ci = 0; ci < choices.length; ci++) {
      const choice = choices[ci];
      const choiceIdx = typeof choice?.index === 'number' ? choice.index : ci;
      const toolCalls = choice?.delta?.tool_calls;
      if (!Array.isArray(toolCalls)) continue;
      for (let ti = 0; ti < toolCalls.length; ti++) {
        const tc = toolCalls[ti];
        const fn = tc?.function;
        if (!fn || typeof fn.name !== 'string') continue;
        const tcIdx = typeof tc.index === 'number' ? tc.index : ti;
        const key = `${choiceIdx}:${tcIdx}`;

        const raw = (this.rawSoFar.get(key) ?? '') + fn.name;
        this.rawSoFar.set(key, raw);

        // Only the portion of `raw` that can't grow into a different restoration
        // is safe to commit. A trailing run that is a proper prefix of a sentinel
        // (`__DOT__` or `__DOT_ESC__`) might still become a dot once more bytes
        // arrive, so hold it back until the next fragment resolves it.
        const committed = restoreToolName(raw.slice(0, raw.length - unsafeSuffixLen(raw)));
        const already = this.emittedLen.get(key) ?? 0;
        fn.name = committed.length > already ? committed.slice(already) : '';
        this.emittedLen.set(key, Math.max(already, committed.length));
      }
    }
  }
}

/**
 * Wrap a vendor SSE stream so dotted tool-call names are restored on the fly.
 *
 * Buffers across chunk boundaries (an SSE `data:` line can be split between two
 * network chunks) and rewrites each `data: {json}` event via a single
 * `StreamingToolNameRestorer`. Non-data lines (`event:`, blank, `data: [DONE]`)
 * and unparseable payloads pass through untouched.
 */
export function restoreStreamToolNames(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const restorer = new StreamingToolNameRestorer();
  let pending = '';

  const rewriteLine = (line: string): string => {
    // SSE data lines look like `data: {json}` (allow a missing space too). Any
    // non-data / `[DONE]` / non-JSON line passes through untouched (shared parser
    // returns undefined for all of those).
    const parsed = parseSseDataLine(line);
    if (parsed === undefined) return line;
    restorer.restoreChunk(parsed as Record<string, unknown>);
    return `data: ${JSON.stringify(parsed)}`;
  };

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      // Emit only complete lines; keep the trailing partial line buffered.
      const nl = pending.lastIndexOf('\n');
      if (nl === -1) return;
      const ready = pending.slice(0, nl + 1);
      pending = pending.slice(nl + 1);
      const out = ready.split('\n').map((l) => (l.endsWith('\r') ? rewriteLine(l.slice(0, -1)) + '\r' : rewriteLine(l))).join('\n');
      controller.enqueue(encoder.encode(out));
    },
    flush(controller) {
      const rest = pending + decoder.decode();
      if (rest.length > 0) controller.enqueue(encoder.encode(rewriteLine(rest)));
    },
  });

  source.pipeTo(writable).catch(() => { /* stream may be cancelled by client */ });
  return readable;
}

/** Restore tool names in a vendor response so the caller sees their original dots. */
export function restoreResponseToolNames(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const out = { ...(raw as Record<string, unknown>) };
  const choices = (out.choices as Array<{ message?: MaybeMessage }> | undefined);
  if (Array.isArray(choices)) {
    out.choices = choices.map((c) => {
      const msg = c.message;
      if (!msg) return c;
      const tcs = msg.tool_calls;
      if (!Array.isArray(tcs)) return c;
      return {
        ...c,
        message: {
          ...msg,
          tool_calls: tcs.map((tc) =>
            tc?.function?.name
              ? { ...tc, function: { ...tc.function, name: restoreToolName(tc.function.name) } }
              : tc,
          ),
        },
      };
    });
  }
  return out;
}
