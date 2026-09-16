/**
 * The working transcript — what of a run the model is SHOWN each turn.
 *
 * A run's full transcript grows without bound; the request sent to the model must not.
 * This module owns the two ways it is kept in bounds: the message-count + token WINDOW
 * (drop-oldest, anchored on a user turn) and AUTO-COMPACTION (fold the older part into a
 * memory note, keep every later message verbatim). Extracted from `brainRunStore.ts` so
 * the run engine only supplies what is run-specific: the transport the summarizer calls
 * and the trace step a fold records.
 *
 * Pure except for {@link buildWorkingTranscript}, which awaits the injected summarizer and
 * updates the caller's `compactMemo`.
 */

import type { ChatCompletionMessage, StreamChatOptions, StreamChatResult } from './streamChatCompletion';

/** How much history we send to the model (message-count ceiling). */
const HISTORY_WINDOW = 80;

/**
 * Token budget for the working transcript sent to the model each turn — how much of this
 * run the model can SEE: the file windows it read, the searches it ran, what it decided.
 *
 * It bounds context, which message-count windowing (HISTORY_WINDOW) alone does not: one
 * `tasks.list` result can be tens of thousands of tokens. It is NOT what keeps a request
 * inside the serving model's window — the gateway fits every request to a model that can
 * hold it (`modelsFittingContext` over `estimateRequestTokens`, with 413 failover behind).
 *
 * It was 24k, "sized under the smallest pool model's window". That protected nothing — the
 * ~16k-token system prompt + tool catalog in front of it already put a full turn at ~40k,
 * past any 32k window — and it cost every coding run its memory. Six 4k-token file windows
 * filled it, compaction folded them into a 1.2k-token note, and the model went back for the
 * files it had just read (chat #105: 55 turns, 63% of calls revisiting, zero edits, prompt
 * peak 40,351). 64k holds a coding task's working set — a dozen-plus file windows —
 * verbatim, while a full turn stays well inside the 128k window every coding-capable pool
 * model has. See {@link windowed} and {@link buildWorkingTranscript}.
 */
export const HISTORY_TOKEN_BUDGET = 64_000;
/**
 * How much of {@link HISTORY_TOKEN_BUDGET} the verbatim TAIL may keep when the older part
 * of the transcript is compacted. The rest is headroom new work fills before the next
 * fold, so the memo is re-folded once per ~20k tokens of progress, not on every turn.
 */
const COMPACT_TAIL_TOKEN_BUDGET = 40_000;

/** Cheap token estimate from a char count — chars/4, the gateway's heuristic. */
function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/** Estimated tokens for one chat message (content + any tool-call payloads). */
function messageTokens(m: ChatCompletionMessage): number {
  let chars = typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length;
  if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  return estimateTokens(chars) + 4; // +4 for role/framing overhead
}

/**
 * The compressed memory of a transcript's older part: `note` summarizes
 * `transcript[0, coveredEnd)`; every message from `coveredEnd` on is sent verbatim.
 */
export interface CompactMemo {
  note: string;
  coveredEnd: number;
}

/**
 * What the working transcript is built from — the run's full transcript and its cached
 * compressed memory. {@link buildWorkingTranscript} updates `compactMemo` in place.
 */
export interface WorkingTranscriptState {
  transcript: ChatCompletionMessage[];
  compactMemo: CompactMemo | null;
}

/**
 * Trim the in-memory transcript to the history window before sending it to the
 * model. Slicing the last N can leave the window starting on an `assistant`
 * tool-call turn or an orphaned `tool` result (whose owning call fell off the
 * front). That payload is invalid for strict vendors: Gemini rejects a request
 * whose conversation does not begin with a user turn — surfaced as the cascade
 * `[googleai] 400 INVALID_ARGUMENT` after a long tool-loop crossed the window
 * boundary (it succeeded for ~20 steps, then 400'd once the triggering user
 * turn slid out of the last-N slice). So anchor the window at a user turn.
 *
 * If the last-N slice contains no user turn (a tool loop longer than the
 * window), fall back to the most recent user turn in the FULL transcript and
 * keep everything after it — correctness over the size cap, and bounded by the
 * run's max iterations anyway.
 */
export function windowed(convo: ChatCompletionMessage[]): ChatCompletionMessage[] {
  let w = convo.slice(-HISTORY_WINDOW);
  while (w.length > 0 && w[0].role !== 'user') w = w.slice(1);
  if (w.length === 0) {
    const lastUser = convo.map((m) => m.role).lastIndexOf('user');
    w = lastUser >= 0 ? convo.slice(lastUser) : convo.slice();
  }
  return tokenBounded(w);
}

/**
 * Enforce the token budget on an already message-count-windowed slice. Drops the
 * OLDEST turns first, then re-anchors on a user turn (a strict vendor like
 * Gemini rejects a window that doesn't start on `user`, and dropping a turn can
 * orphan a `tool` result whose `assistant` tool-call fell off the front — so we
 * also drop leading `tool`/`assistant` turns after trimming). The most recent
 * user turn is never dropped: correctness over the budget when a single turn is
 * itself oversized (its tool results are already per-result trimmed on the way
 * into the transcript, so this is rare).
 */
function tokenBounded(w: ChatCompletionMessage[]): ChatCompletionMessage[] {
  let total = w.reduce((sum, m) => sum + messageTokens(m), 0);
  if (total <= HISTORY_TOKEN_BUDGET) return w;
  // The last user turn's index — never trim past it.
  const lastUser = w.map((m) => m.role).lastIndexOf('user');
  let start = 0;
  while (total > HISTORY_TOKEN_BUDGET && start < lastUser) {
    total -= messageTokens(w[start]!);
    start += 1;
  }
  let trimmed = w.slice(start);
  // Re-anchor: never begin on a tool result or an assistant tool-call turn whose
  // partner was just dropped.
  while (trimmed.length > 1 && trimmed[0].role !== 'user') trimmed = trimmed.slice(1);
  return trimmed;
}

/**
 * Is a transcript message still part of what the model sees? False once auto-compaction
 * has folded it into the memory note, or the drop-oldest window has let it fall off the
 * front. Deliberately conservative: it judges against the CURRENT transcript (which has
 * grown since the last working set was built), so it can only ever call a message gone a
 * turn early — a needless replay costs tokens, a stub for a vanished result costs the run.
 */
export function stillInWorkingContext(state: WorkingTranscriptState, anchor: unknown): boolean {
  const convo = state.transcript;
  const idx = convo.indexOf(anchor as ChatCompletionMessage);
  if (idx < 0) return false;
  if (state.compactMemo) return idx >= verbatimStart(convo, state.compactMemo.coveredEnd);
  return windowed(convo).includes(convo[idx]!);
}

// ---------------------------------------------------------------------------
// Auto-compaction — summarize the bulky MIDDLE instead of dropping it.
//
// `tokenBounded` above keeps the request inside the model window by DROPPING the
// oldest turns. That never 413s, but it silently LOSES context — which made a weak
// model re-read files and thrash until it burned the tool-iteration cap ("LOOP
// EXHAUSTED", the chat #50 failure). When a summarizer is available we instead
// compress the older turns into ONE concise memory note (the same pattern the cloud
// coding loop uses server-side via compactMessages), so the model keeps working from
// a distilled memory and converges. Falls back to `tokenBounded` (drop) when no
// summarizer is reachable, so correctness never depends on the extra LLM call.
// ---------------------------------------------------------------------------

/** The fewest recent messages the verbatim tail keeps, however large they are. */
export const COMPACT_TAIL_TURNS = 8;

/** The most recent messages the verbatim tail may hold — half the message window, so a
 *  compacted transcript stays inside {@link HISTORY_WINDOW} with room to grow. */
const COMPACT_TAIL_MAX_MESSAGES = HISTORY_WINDOW / 2;

/** The first index at or after `from` that is not a `tool` result: a tool row whose
 *  assistant call was folded into the memo would be orphaned (strict vendors 400 on it).
 *  Pure/testable. */
export function verbatimStart(convo: ChatCompletionMessage[], from: number): number {
  let start = Math.max(0, Math.min(from, convo.length));
  while (start < convo.length && convo[start]!.role === 'tool') start += 1;
  return start;
}

/** Start index of the last `tailTurns` messages, walked off a leading `tool` result. Pure/testable. */
export function compactTailStart(convo: ChatCompletionMessage[], tailTurns: number): number {
  return verbatimStart(convo, convo.length - tailTurns);
}

/**
 * Where the verbatim tail begins when the transcript is compacted: as many of the most
 * recent messages as fit in `budgetTokens` — never fewer than {@link COMPACT_TAIL_TURNS},
 * never more than {@link COMPACT_TAIL_MAX_MESSAGES} — walked off a leading tool result.
 *
 * Sized by TOKENS, not a message count. The tail used to be a fixed eight messages, which
 * is four tool results: after a fold the model kept its last four reads verbatim and one
 * short note for everything else, so the fifth file it needed was always the one it had to
 * read again. Pure/testable.
 */
export function compactTailStartForBudget(convo: ChatCompletionMessage[], budgetTokens: number): number {
  let start = convo.length;
  let tokens = 0;
  while (start > 0) {
    const kept = convo.length - start;
    if (kept >= COMPACT_TAIL_MAX_MESSAGES) break;
    const next = messageTokens(convo[start - 1]!);
    if (kept >= COMPACT_TAIL_TURNS && tokens + next > budgetTokens) break;
    tokens += next;
    start -= 1;
  }
  return verbatimStart(convo, start);
}

/**
 * Index of the MOST RECENT user turn to re-inject verbatim ahead of the tail — the
 * ACTIVE directive — or -1 when the latest user turn is already inside the tail (so it
 * needs no re-injection). This is the fix for the "reverts to the opening request"
 * failure: compaction used to pin the FIRST user turn as the run anchor, so in a chat
 * with several successive instructions the model kept re-anchoring on the stale
 * opening message (chat #55: it re-ran the initial "self-diagnostic" and abandoned the
 * live "create the gap and fix the code" order — twice). The current instruction is
 * always the LATEST user turn, never the first, so that is what must survive verbatim.
 * Pure/testable.
 */
export function pinnedDirectiveIndex(convo: ChatCompletionMessage[], tailStart: number): number {
  const lastUser = convo.map((m) => m.role).lastIndexOf('user');
  return lastUser >= 0 && lastUser < tailStart ? lastUser : -1;
}

/**
 * Assemble the working transcript from a compressed-memory `note` that covers
 * `convo[0, coveredEnd)`: system + the memory note + the ACTIVE user directive re-injected
 * verbatim (the most recent user turn, when the note covers it) + EVERY message from
 * `coveredEnd` on (tool-pairing safe via {@link verbatimStart}). Nothing is in neither the
 * note nor the tail. Pure so partitioning is unit-tested; the note text comes from the
 * async summarizer.
 *
 * The directive sits immediately before the tail — the most-recent pre-tail position —
 * so the model reads it as the CURRENT instruction, not a stale opening task the memo
 * also mentions. Pinning the FIRST user turn here (the previous behavior) is exactly
 * what made a multi-instruction chat revert to its opening request and ignore the live
 * order.
 */
export function assembleCompacted(
  systemPrompt: string,
  convo: ChatCompletionMessage[],
  note: string,
  coveredEnd: number,
): ChatCompletionMessage[] {
  const tailStart = verbatimStart(convo, coveredEnd);
  const out: ChatCompletionMessage[] = [{ role: 'system', content: systemPrompt }];
  out.push({ role: 'assistant', content: note });
  const directiveIdx = pinnedDirectiveIndex(convo, tailStart);
  if (directiveIdx >= 0) out.push(convo[directiveIdx]!);
  out.push(...convo.slice(tailStart));
  return out;
}

/** Render a slice of the transcript to a compact text the summarizer compresses. */
function renderForSummary(msgs: ChatCompletionMessage[]): string {
  return msgs
    .map((m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      const calls = m.tool_calls?.length
        ? ` [called: ${m.tool_calls.map((t) => t.function?.name).filter(Boolean).join(', ')}]`
        : '';
      return `${m.role}${calls}: ${content}`;
    })
    .join('\n\n');
}

/**
 * The slice of the run's streaming transport the summarizer uses — typed structurally so
 * this module does not depend on the run store (`BrainStreamFn` satisfies it).
 */
export type SummaryStreamFn = (
  opts: Omit<StreamChatOptions, 'transport'>,
) => Promise<Pick<StreamChatResult, 'text'>>;

/** Client-side summarizer built from the injected `stream` transport: one no-tools
 *  completion that compresses an in-progress agent transcript into a dense memory.
 *  Returns null on any failure/empty so the caller falls back to drop-oldest. */
export async function summarizeMiddle(
  stream: SummaryStreamFn,
  model: string | undefined,
  msgs: ChatCompletionMessage[],
  signal: AbortSignal | undefined,
): Promise<string | null> {
  if (msgs.length === 0) return null;
  try {
    const res = await stream({
      messages: [
        {
          role: 'system',
          content:
            'You compress an in-progress AI agent transcript into a concise MEMORY the agent keeps working from. Capture: the CURRENT outstanding instruction from the user (the most recent user message is authoritative — earlier requests it supersedes are history, not the active task), concrete facts/answers discovered, tool results that matter (ids, paths, values), decisions made, and what still remains to do. Keep every file path, symbol name and line number the remaining work depends on, with the specific facts learned from each file — the agent no longer sees those results, so what you leave out it must read again. Be information-dense; drop pleasantries. No preamble.',
        },
        { role: 'user', content: renderForSummary(msgs) },
      ],
      model,
      // A compaction note is a UTILITY completion: a bounded answer with no thinking.
      // Left unset, it inherited the run's full output ceiling and, on a thinking-
      // capable model, the run's reasoning depth — the most expensive way to write a
      // paragraph the user never sees. Bounded at ~2.5k tokens: the note is the agent's
      // only record of every file it folds (paths, symbols, line numbers), and 1.2k was
      // too little to carry them — the run re-read whatever the note had to leave out.
      maxTokens: 2_500,
      reasoning: { level: 'off' },
      signal,
    });
    const out = (res.text ?? '').trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Estimated tokens for a run of messages. */
function tokensOf(msgs: readonly ChatCompletionMessage[]): number {
  return msgs.reduce((sum, m) => sum + messageTokens(m), 0);
}

/** Can these messages (plus `extraTokens` in front of them) go to the model verbatim —
 *  inside both the token budget and the message window? */
function fitsVerbatim(msgs: readonly ChatCompletionMessage[], extraTokens = 0): boolean {
  return msgs.length <= HISTORY_WINDOW && extraTokens + tokensOf(msgs) <= HISTORY_TOKEN_BUDGET;
}

/**
 * Build the working transcript for a turn. When the whole transcript fits → all of it,
 * verbatim. Otherwise → a memory note of the older part plus EVERY message after it,
 * verbatim; `onFolded` is told how many messages a new fold compressed, so the caller can
 * record a visible `context.compacted` step and the chat SHOWS the fold.
 *
 * The note is folded INCREMENTALLY, and only when it has to be. A note whose verbatim
 * remainder still fits is reused as-is; once it no longer fits, the previous note plus
 * exactly the messages since it are folded into a new one, up to a token-sized tail
 * ({@link compactTailStartForBudget}). The old fold re-summarised a fixed "all but the last
 * eight" span on a count of new turns, so every message that slid out of the tail between
 * two folds sat in neither the note nor the tail — the run's most recent reads, gone
 * without a trace. Falls back to drop-oldest when the summarizer is unavailable (`summarize`
 * resolves null).
 *
 * A message-count overflow folds too: past {@link HISTORY_WINDOW} messages the window used
 * to drop the oldest silently even while the tokens fit.
 */
export async function buildWorkingTranscript(
  state: WorkingTranscriptState,
  systemPrompt: string,
  summarize: (msgs: ChatCompletionMessage[]) => Promise<string | null>,
  onFolded: (droppedMessages: number) => void,
): Promise<ChatCompletionMessage[]> {
  const convo = state.transcript;
  if (fitsVerbatim(convo)) {
    state.compactMemo = null; // back under budget — a later overflow summarizes afresh
    return [{ role: 'system', content: systemPrompt }, ...windowed(convo)];
  }
  // A note written against a transcript that has since been replaced covers nothing here.
  const memo = state.compactMemo && state.compactMemo.coveredEnd <= convo.length ? state.compactMemo : null;
  if (memo && fitsVerbatim(convo.slice(verbatimStart(convo, memo.coveredEnd)), estimateTokens(memo.note.length))) {
    return assembleCompacted(systemPrompt, convo, memo.note, memo.coveredEnd);
  }
  const from = memo?.coveredEnd ?? 0;
  const to = Math.max(from, compactTailStartForBudget(convo, COMPACT_TAIL_TOKEN_BUDGET));
  const fold: ChatCompletionMessage[] = memo
    ? [{ role: 'assistant', content: memo.note }, ...convo.slice(from, to)]
    : convo.slice(from, to);
  const summary = to > from ? await summarize(fold) : null;
  if (summary == null) {
    // Nothing new to fold, or no summarizer: keep the note already held, else drop-oldest.
    return memo
      ? assembleCompacted(systemPrompt, convo, memo.note, memo.coveredEnd)
      : [{ role: 'system', content: systemPrompt }, ...windowed(convo)];
  }
  const note = `Compressed memory of the first ${to} message(s) of this conversation:\n${summary}`;
  state.compactMemo = { note, coveredEnd: to };
  onFolded(to - from);
  return assembleCompacted(systemPrompt, convo, note, to);
}
