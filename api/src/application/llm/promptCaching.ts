/**
 * Anthropic prompt-cache breakpoint injection for the gateway request path.
 *
 * The gateway already *reads* prompt-cache usage — `pickUsage` extracts
 * `cache_read_tokens` / `cache_creation_tokens` and the proxy persists them so
 * cost accounting can discount cache reads (~0.1x). But those reads are
 * structurally always zero unless something *writes* the cache, and
 * Anthropic-family models only cache when the request carries explicit
 * `cache_control` breakpoints. OpenAI / Grok / DeepSeek cache automatically and
 * ignore markers; Gemini caches implicitly. So this module injects breakpoints
 * for exactly the family that needs-and-honours them (Anthropic via OpenRouter)
 * — completing the caching+metering pair the gateway was missing.
 *
 * Prefix-match invariant (see Anthropic prompt-caching docs): a breakpoint
 * caches everything *before and including* it, so we mark the system prompt and
 * the LATEST conversation turn. Marking the latest turn is Anthropic's documented
 * incremental-conversation pattern: turn N writes the prefix through its last
 * turn (a ~1.25x write on that small tail), and turn N+1 finds that boundary and
 * reads everything before it at ~0.1x. The earlier layout left the final turn
 * unmarked "so it never enters the cached prefix" — which meant the NEXT request
 * could never read it either, so a tool loop re-billed its whole growing history
 * at full price every turn. Byte-stable: only static `cache_control` objects are
 * added, never timestamps or ids.
 * Non-destructive: returns a new array and clones only the messages it marks —
 * the caller's `messages` is shared by reference across cascade candidates, so a
 * non-Anthropic candidate must still see clean, unmarked messages.
 */

/**
 * Cache-tier marker. Anthropic's default `ephemeral` breakpoint has a ~5-minute
 * TTL; the opt-in `ttl: '1h'` extends it to one hour (~2x write cost) so a stable
 * prefix survives multi-minute idle gaps between a bursty tenant's calls. The
 * gateway selects `'1h'` only when the caller passes `_builderforce.cacheTtl:'1h'`
 * (see {@link resolveCacheTtl} in LlmProxyService) — otherwise the 5-min default.
 */
export type CacheTtl = '5m' | '1h';

const EPHEMERAL = { type: 'ephemeral' as const };
const EPHEMERAL_1H = { type: 'ephemeral' as const, ttl: '1h' as const };

/** Marker object for the requested TTL. `'5m'` (default) → bare ephemeral;
 *  `'1h'` → ephemeral with the long-retention flag OpenRouter forwards to
 *  Anthropic. Returned as a shared frozen literal so placement stays byte-stable
 *  (no per-call object identity churn that could perturb a cached prefix). */
function markerForTtl(ttl: CacheTtl | undefined): Record<string, unknown> {
  return ttl === '1h' ? EPHEMERAL_1H : EPHEMERAL;
}

type Msg = Record<string, unknown>;

/**
 * Anthropic family reached through the gateway — the only upstreams that require
 * an explicit `cache_control` marker to cache. OpenRouter catalog ids are
 * `anthropic/...`; the `claude` substring also covers a caller-pinned id that
 * isn't in the catalog (e.g. `openrouter/anthropic/claude-...`).
 */
export function modelSupportsExplicitCaching(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith('anthropic/') || m.includes('/anthropic/') || m.includes('claude');
}

/** True when any message already carries a `cache_control` marker — the caller
 *  is managing caching deliberately, so we leave placement untouched (avoids a
 *  duplicate breakpoint and respects an intentional cap-of-4 layout). */
function hasCallerCacheControl(messages: ReadonlyArray<Msg>): boolean {
  return messages.some((m) => {
    const c = (m as { content?: unknown }).content;
    return Array.isArray(c) && c.some((p) => p != null && typeof p === 'object' && 'cache_control' in (p as object));
  });
}

/**
 * Return a copy of `msg` whose last text content block carries `cache_control`.
 * String content is promoted to a single text block — the form Anthropic via
 * OpenRouter requires for a breakpoint. Returns the original reference when
 * there's no text block to mark (nothing cacheable to attach to). `marker` is
 * the TTL-specific `cache_control` object ({@link markerForTtl}).
 */
function withCacheControl(msg: Msg, marker: Record<string, unknown>): Msg {
  const content = (msg as { content?: unknown }).content;

  if (typeof content === 'string') {
    if (content.length === 0) return msg;
    return { ...msg, content: [{ type: 'text', text: content, cache_control: marker }] };
  }

  if (Array.isArray(content)) {
    const parts = content as Array<Record<string, unknown>>;
    let idx = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      if ((parts[i] as { type?: unknown })?.type === 'text') { idx = i; break; }
    }
    if (idx < 0) return msg;
    return { ...msg, content: parts.map((p, i) => (i === idx ? { ...p, cache_control: marker } : p)) };
  }

  return msg;
}

/**
 * Inject `cache_control` breakpoints into an OpenAI-format `messages` array for
 * caching-capable Anthropic models. No-op (returns the input reference) for
 * non-Anthropic models, empty input, or caller-managed caching.
 *
 * Breakpoints (≤ 2, well within Anthropic's cap of 4):
 *   1. the last `system` message — the largest stable prefix, the biggest win;
 *   2. the LATEST user/assistant turn that carries text — so the next request
 *      reads the whole conversation so far as a cached prefix. `tool` turns are
 *      skipped: an OpenAI-format tool message carries string content, and this
 *      OpenRouter path does not promote it to a block (the direct vendor marks
 *      tool results natively — see {@link markAnthropicHistoryBreakpoint}).
 *
 * `ttl` (default `'5m'`) selects the breakpoint retention — pass `'1h'` (from a
 * caller's `_builderforce.cacheTtl` hint) to keep the prefix warm across idle
 * gaps longer than the 5-minute ephemeral window.
 */
export function applyPromptCaching(messages: Array<Msg>, model: string, ttl?: CacheTtl): Array<Msg> {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  if (!modelSupportsExplicitCaching(model)) return messages;
  if (hasCallerCacheControl(messages)) return messages;

  const marker = markerForTtl(ttl);

  const marks = new Set<number>();

  // (1) System prefix.
  let lastSystem = -1;
  for (let i = 0; i < messages.length; i++) {
    if ((messages[i] as { role?: unknown }).role === 'system') lastSystem = i;
  }
  if (lastSystem >= 0) marks.add(lastSystem);

  // (2) The latest user/assistant turn that can carry a marker — walking back
  // past tool turns and past an assistant tool-call turn with no text.
  for (let i = messages.length - 1; i > lastSystem; i--) {
    const role = (messages[i] as { role?: unknown }).role;
    if (role !== 'user' && role !== 'assistant') continue;
    if (withCacheControl(messages[i]!, marker) === messages[i]) continue; // nothing markable
    marks.add(i);
    break;
  }

  if (marks.size === 0) return messages;
  return messages.map((m, i) => (marks.has(i) ? withCacheControl(m, marker) : m));
}

/** A block-content message as the direct Anthropic Messages vendor sends it. */
export interface AnthropicBlockMessage {
  role: string;
  content: Array<Record<string, unknown>>;
}

/**
 * Mark the FINAL message's last content block for the direct Anthropic vendor — the
 * same incremental-conversation breakpoint as above, in native Messages shape, where
 * ANY block may carry it (text, tool_use, tool_result, image). The direct vendor
 * cached tools + system and nothing else, so a 26-turn tool loop with a 24k-token
 * transcript (chat #101) paid full price for that transcript on every turn. With the
 * breakpoint on the last block, turn N+1 reads turn N's whole prefix at ~0.1x.
 * Non-destructive: a new array, and only the last message and block are cloned. An
 * empty final message (nothing to attach to) is returned untouched.
 */
export function markAnthropicHistoryBreakpoint<M extends AnthropicBlockMessage>(
  messages: readonly M[],
  marker: Record<string, unknown> = EPHEMERAL,
): M[] {
  if (messages.length === 0) return [...messages];
  const last = messages[messages.length - 1]!;
  if (!Array.isArray(last.content) || last.content.length === 0) return [...messages];
  const blocks = last.content;
  const marked = { ...blocks[blocks.length - 1]!, cache_control: marker };
  const next = { ...last, content: [...blocks.slice(0, -1), marked] } as M;
  return [...messages.slice(0, -1), next];
}
