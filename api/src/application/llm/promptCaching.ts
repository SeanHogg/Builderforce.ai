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
 * caches everything *before* it, so we mark the stable prefix — the system
 * prompt, plus the conversation-history boundary — and leave the volatile final
 * user turn unmarked so it never enters the cached prefix. Byte-stable: only
 * static `cache_control` objects are added, never timestamps or ids.
 * Non-destructive: returns a new array and clones only the messages it marks —
 * the caller's `messages` is shared by reference across cascade candidates, so a
 * non-Anthropic candidate must still see clean, unmarked messages.
 */

const EPHEMERAL = { type: 'ephemeral' as const };

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
 * there's no text block to mark (nothing cacheable to attach to).
 */
function withCacheControl(msg: Msg): Msg {
  const content = (msg as { content?: unknown }).content;

  if (typeof content === 'string') {
    if (content.length === 0) return msg;
    return { ...msg, content: [{ type: 'text', text: content, cache_control: EPHEMERAL }] };
  }

  if (Array.isArray(content)) {
    const parts = content as Array<Record<string, unknown>>;
    let idx = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      if ((parts[i] as { type?: unknown })?.type === 'text') { idx = i; break; }
    }
    if (idx < 0) return msg;
    return { ...msg, content: parts.map((p, i) => (i === idx ? { ...p, cache_control: EPHEMERAL } : p)) };
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
 *   2. the message immediately before the final turn (history boundary) — so a
 *      follow-up request reads the whole prior-conversation prefix.
 */
export function applyPromptCaching(messages: Array<Msg>, model: string): Array<Msg> {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  if (!modelSupportsExplicitCaching(model)) return messages;
  if (hasCallerCacheControl(messages)) return messages;

  const marks = new Set<number>();

  // (1) System prefix.
  let lastSystem = -1;
  for (let i = 0; i < messages.length; i++) {
    if ((messages[i] as { role?: unknown }).role === 'system') lastSystem = i;
  }
  if (lastSystem >= 0) marks.add(lastSystem);

  // (2) Conversation-history boundary — only a user/assistant turn carries a
  // stable text block worth a breakpoint; tool turns and the volatile final
  // turn are skipped.
  if (messages.length >= 3) {
    const boundary = messages.length - 2;
    const role = (messages[boundary] as { role?: unknown }).role;
    if (boundary !== lastSystem && (role === 'user' || role === 'assistant')) {
      marks.add(boundary);
    }
  }

  if (marks.size === 0) return messages;
  return messages.map((m, i) => (marks.has(i) ? withCacheControl(m) : m));
}
