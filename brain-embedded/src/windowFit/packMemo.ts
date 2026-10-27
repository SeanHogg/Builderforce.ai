/**
 * The run's memo of its last window-fit pack — so a pinned small-window model is NOT
 * re-packed (and its dropped middle re-summarized) on every turn.
 *
 * A pack is a pure function of the transcript, but re-running it each turn moves the
 * cut, rewrites the note, and calls the summarizer again: the request's prefix changes
 * every turn (no prefix cache can hit) and every turn pays for a summary. A transcript
 * only GROWS at its end between turns, so the previous pack stays valid while the new
 * request still opens with the history that pack was made from: the new messages are
 * appended after the packed prefix, verbatim, and the run re-packs only once that no
 * longer fits the window.
 *
 * The packer keeps a trailing volatile tail (`<run-state>`) last and outside the history
 * it packs (`packHandoff`); the memo does the same, so the per-turn tail never decides
 * whether a pack is reused.
 */

import { defaultEstimateTokens, isVolatileTail, tokensOf, type HandoffMessage } from '@seanhogg/builderforce-memory/handoff';
import type { ChatCompletionMessage } from '../streamChatCompletion';

/** One pack: the history it was made from and the history it produced. */
export interface PackMemo {
  history: readonly ChatCompletionMessage[];
  packed: readonly ChatCompletionMessage[];
}

/** The messages before the trailing run of volatile tails, and that run. */
function splitVolatileTail(messages: readonly ChatCompletionMessage[]): { history: ChatCompletionMessage[]; tail: ChatCompletionMessage[] } {
  let cut = messages.length;
  while (cut > 0 && isVolatileTail(messages[cut - 1]! as HandoffMessage)) cut -= 1;
  return { history: messages.slice(0, cut), tail: messages.slice(cut) };
}

/**
 * Do two messages send the same bytes? The working transcript rebuilds its system
 * prompt and compaction note as new objects every turn (same strings), while every other
 * message is the transcript's own object — so this is reference equality plus value
 * equality on the string fields, never a deep compare of a large history.
 */
function sameMessage(a: ChatCompletionMessage, b: ChatCompletionMessage): boolean {
  return a === b || (a.role === b.role && a.content === b.content && a.tool_calls === b.tool_calls && a.tool_call_id === b.tool_call_id);
}

/** The memo of a pack of `input` that produced `output`. */
export function packMemoOf(input: readonly ChatCompletionMessage[], output: readonly ChatCompletionMessage[]): PackMemo {
  return { history: splitVolatileTail(input).history, packed: splitVolatileTail(output).history };
}

/**
 * The memoised pack extended by everything the request added since — its new history
 * verbatim after the packed prefix, then its volatile tail — when the request still opens
 * with the memo's history and the result fits `budgetTokens` (the packer's own budget and
 * estimate). Null ⇒ the caller re-packs.
 */
export function reusePack(memo: PackMemo, messages: readonly ChatCompletionMessage[], budgetTokens: number): ChatCompletionMessage[] | null {
  const { history, tail } = splitVolatileTail(messages);
  if (history.length < memo.history.length) return null;
  for (let i = 0; i < memo.history.length; i++) if (!sameMessage(history[i]!, memo.history[i]!)) return null;
  const out = [...memo.packed, ...history.slice(memo.history.length), ...tail];
  return tokensOf(out as HandoffMessage[], defaultEstimateTokens) <= budgetTokens ? out : null;
}
