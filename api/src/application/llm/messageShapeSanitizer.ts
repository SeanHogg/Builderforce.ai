/**
 * MESSAGE-SHAPE SANITIZER — make a conversation acceptable to a strict vendor
 * without changing what it says.
 *
 * The OpenAI chat-completions shape is permissive; several vendors that speak it are
 * not. Gemini in particular rejects with a bare `INVALID_ARGUMENT` — no field, no
 * index — for histories every other vendor accepts, which makes the failure land
 * far from its cause: the cascade advances, some other model answers, and nothing
 * anywhere says the FIRST candidate was rejected for the shape of the transcript
 * rather than for anything about the model.
 *
 * Three real shapes cause it, and all three are produced by ordinary agent loops
 * rather than by malformed callers:
 *
 *   1. A NON-USER-LEADING history. A resumed agent turn replays `[assistant, user,
 *      …]`, or a summarizer sends a lone `assistant` message. Gemini requires the
 *      first non-system turn to be `user`.
 *   2. AN EMPTY TOOL-CALL `arguments`. A model that takes a no-argument tool emits
 *      `arguments: ""`. Gemini requires parseable JSON, so `""` is invalid where
 *      `"{}"` is fine — and the two mean the same thing.
 *   3. CONSECUTIVE SAME-ROLE turns. Tool-heavy loops interleave several assistant
 *      messages; strict vendors require the roles to alternate.
 *
 * DESIGN RULES, because a sanitizer that changes meaning is worse than a 400:
 *   • Nothing is ever DROPPED. Consecutive same-role turns are merged, not discarded.
 *   • Nothing is ever REWORDED. The only synthesized text is a neutral continuation
 *     marker when a history genuinely cannot start with `user`.
 *   • It runs ONLY for vendors that need it, decided from catalog metadata rather
 *     than a vendor-id list — the same reason `strictSchemaSupport` is metadata.
 *   • It is PURE and returns the input array by reference when nothing needed fixing,
 *     so the overwhelmingly common case allocates nothing.
 */

/**
 * The registry injects the model → strict-shape lookup at import time, exactly as it
 * does for `registerSchemaDialectResolver` in `jsonSchemaSanitize`. Importing the
 * registry directly from here would close a cycle — the vendor modules import this
 * file, and the registry imports the vendor modules — and the constants are built
 * eagerly, so the cycle would deadlock at module-eval rather than fail loudly.
 */
type StrictShapeResolver = (model: string) => boolean;

let strictShapeResolver: StrictShapeResolver = () => false;

/** Registry calls this once at module-init. Until it does, the sanitizer is inert,
 *  which is the correct default: doing nothing cannot break a permissive vendor. */
export function registerStrictShapeResolver(resolver: StrictShapeResolver): void {
  strictShapeResolver = resolver;
}

/** The minimal message shape this operates on. */
export interface ChatMessageLike {
  role: string;
  content?: unknown;
  tool_calls?: Array<{ function?: { arguments?: unknown; name?: unknown }; [k: string]: unknown }>;
  [k: string]: unknown;
}

/**
 * A neutral marker inserted only when a history cannot legally start with `user`.
 * Deliberately content-free: it exists to satisfy the alternation requirement, not
 * to add an instruction the caller did not write.
 */
const CONTINUATION_MARKER = '(continuing the conversation)';

/**
 * Does this model's vendor reject the permissive OpenAI message shape?
 *
 * Derived from the same catalog metadata as the schema ceiling: a vendor whose
 * constrained decoder is `limited` is a vendor whose request validator is strict.
 * Keeping it metadata-driven means the next such vendor is one field away rather
 * than a hardcoded id somebody has to remember to add.
 */
export function needsMessageShapeSanitizing(model: string): boolean {
  return strictShapeResolver(model);
}

/** Merge two message contents without losing either. Both string → newline-joined;
 *  otherwise both are promoted to a content-part array. */
function mergeContent(a: unknown, b: unknown): unknown {
  if (typeof a === 'string' && typeof b === 'string') {
    return a.length === 0 ? b : b.length === 0 ? a : `${a}\n\n${b}`;
  }
  const toParts = (v: unknown): unknown[] =>
    Array.isArray(v) ? v : typeof v === 'string' && v.length > 0 ? [{ type: 'text', text: v }] : [];
  return [...toParts(a), ...toParts(b)];
}

/**
 * Rewrite a message list into a shape a strict vendor accepts.
 *
 * Returns the input array unchanged (by reference) when it is already valid, so a
 * caller can cheaply detect "nothing happened".
 */
export function sanitizeMessageShape(messages: readonly ChatMessageLike[]): ChatMessageLike[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages as ChatMessageLike[];
  let changed = false;

  // ── 1. Empty tool-call arguments → "{}" ──────────────────────────────────
  // `""` and `"{}"` mean the same thing to every model that emitted the former;
  // only the validator disagrees.
  const withArgs = messages.map((m) => {
    if (!Array.isArray(m.tool_calls) || m.tool_calls.length === 0) return m;
    let touched = false;
    const calls = m.tool_calls.map((call: NonNullable<ChatMessageLike['tool_calls']>[number]) => {
      const args = call?.function?.arguments;
      if (args !== '' && args !== undefined && args !== null) return call;
      touched = true;
      return { ...call, function: { ...(call.function ?? {}), arguments: '{}' } };
    });
    if (!touched) return m;
    changed = true;
    return { ...m, tool_calls: calls };
  });

  // System messages are positionally exempt from the alternation rule — they lead.
  const leadingSystem: ChatMessageLike[] = [];
  let i = 0;
  while (i < withArgs.length && withArgs[i]!.role === 'system') {
    leadingSystem.push(withArgs[i]!);
    i += 1;
  }
  const body = withArgs.slice(i);

  // ── 2. First non-system turn must be `user` ──────────────────────────────
  const withLead: ChatMessageLike[] = [...body];
  if (withLead.length > 0 && withLead[0]!.role !== 'user') {
    // Prepend rather than relabel: relabelling an assistant turn to `user` would
    // attribute the model's own words to the caller, which changes what the
    // conversation MEANS. A neutral marker only satisfies the ordering rule.
    withLead.unshift({ role: 'user', content: CONTINUATION_MARKER });
    changed = true;
  }

  // ── 3. Collapse consecutive same-role turns ──────────────────────────────
  // `tool` messages are exempt: several tool results legitimately follow one
  // assistant turn, and every strict vendor accepts that — merging them would
  // destroy the tool_call_id ↔ result pairing.
  const alternating: ChatMessageLike[] = [];
  for (const message of withLead) {
    const prev = alternating[alternating.length - 1];
    const mergeable = prev
      && prev.role === message.role
      && message.role !== 'tool'
      && !Array.isArray(prev.tool_calls)
      && !Array.isArray(message.tool_calls);
    if (mergeable) {
      alternating[alternating.length - 1] = { ...prev, content: mergeContent(prev.content, message.content) };
      changed = true;
      continue;
    }
    alternating.push(message);
  }

  return changed ? [...leadingSystem, ...alternating] : (messages as ChatMessageLike[]);
}
