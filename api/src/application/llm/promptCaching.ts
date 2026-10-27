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

import { isVolatileContent } from '@seanhogg/builderforce-memory/handoff';

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
 * Does this OpenAI-format message carry a loop's per-turn VOLATILE tail
 * (`@seanhogg/builderforce-memory/handoff`, cost lever B1) — the affect block, budget
 * line, task state and working-memory brief sent AFTER the history? Such a message is
 * never given the history breakpoint: the breakpoint goes on the one before it, so the
 * next turn reads the whole stable prefix from the cache instead of missing on bytes
 * that change every turn. Shared by the OpenRouter placer below and the Anthropic vendor.
 */
function isVolatileTailMessage(msg: Msg): boolean {
  return isVolatileContent((msg as { content?: unknown }).content);
}

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
 * The ONE "last stable item" rule both history placers share — this OpenRouter path
 * (over OpenAI-format messages) and the direct Anthropic vendor (over a message's
 * native blocks): walk back from the end, past the per-turn volatile tail (B1, whose
 * bytes change every turn and would make the breakpoint miss) and past anything that
 * cannot carry a marker, and return the index of the first item left — or -1. Items at
 * or before `floor` are never considered.
 */
export function lastStableIndex<T>(
  items: readonly T[],
  isVolatile: (item: T) => boolean,
  canMark: (item: T) => boolean,
  floor = -1,
): number {
  for (let i = items.length - 1; i > floor; i--) {
    const item = items[i]!;
    if (isVolatile(item) || !canMark(item)) continue;
    return i;
  }
  return -1;
}

/** Roles whose OpenAI-format message can take the history breakpoint. A `tool` result
 *  qualifies: its string content is promoted to a text part, which OpenRouter forwards
 *  to Anthropic as a `tool_result` content block carrying the marker. */
const HISTORY_ROLES = new Set(['user', 'assistant', 'tool']);

/** Roles whose marker reaches Anthropic as a plain TEXT block — the fallback breakpoint. */
const TEXT_ROLES = new Set(['user', 'assistant']);

/** Anthropic's cap on `cache_control` breakpoints per request (tools + system + messages). */
export const ANTHROPIC_MAX_BREAKPOINTS = 4;

/**
 * Inject `cache_control` breakpoints into an OpenAI-format `messages` array for
 * caching-capable Anthropic models. No-op (returns the input reference) for
 * non-Anthropic models, empty input, or caller-managed caching.
 *
 * Breakpoints (≤ 3; this path marks no tools, so with Anthropic's cap of 4 —
 * {@link ANTHROPIC_MAX_BREAKPOINTS}, tools + system + messages — one slot stays free):
 *   1. the last `system` message — the largest stable prefix, the biggest win;
 *   2. the last STABLE history message ({@link lastStableIndex}) — so the next request
 *      reads the whole conversation so far as a cached prefix. Tool results count: in
 *      a tool loop the newest stable message IS a tool result, and skipping it parked
 *      the breakpoint on the last text turn, so every tool turn after it was re-billed
 *      at full price. Only a text-less assistant tool-call turn (nothing to attach to)
 *      and the trailing `<run-state>` tail are walked past;
 *   3. when (2) landed on a `tool` message, ALSO the last stable user/assistant TEXT
 *      message before it. A marker on a tool-role content part relies on OpenRouter
 *      carrying it onto the translated `tool_result` block; the text-message marker is
 *      the documented shape, so if the tool-part marker is ever dropped in translation
 *      the prefix through the last text turn still caches instead of nothing at all.
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

  // (2) The last stable history message that can carry a marker.
  const history = lastStableIndex(
    messages,
    isVolatileTailMessage,
    (m) => HISTORY_ROLES.has(String((m as { role?: unknown }).role)) && withCacheControl(m, marker) !== m,
    lastSystem,
  );
  if (history >= 0) marks.add(history);

  // (3) Fallback: a tool-result breakpoint also gets a text one behind it.
  if (history >= 0 && (messages[history] as { role?: unknown }).role === 'tool') {
    const text = lastStableIndex(
      messages.slice(0, history),
      isVolatileTailMessage,
      (m) => TEXT_ROLES.has(String((m as { role?: unknown }).role)) && withCacheControl(m, marker) !== m,
      lastSystem,
    );
    if (text >= 0) marks.add(text);
  }

  if (marks.size === 0) return messages;
  return messages.map((m, i) => (marks.has(i) ? withCacheControl(m, marker) : m));
}
