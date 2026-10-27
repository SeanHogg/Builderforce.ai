/**
 * The chat's CHANGE ASKS — every distinct change the person has asked for in the
 * transcript the run opens with, so a follow-up never silently drops the work it follows.
 *
 * Chat #5739 asked "remove the title from the top of the VSIX", then added a steering
 * bug, then said "complete the implementation" three times. Each run read only its own
 * latest message: the coders a hand-off started were given "complete the implementation"
 * as their whole goal (they see nothing else), the title was never removed, and the user
 * had to ask twice whether the original request was done. Here a CHANGE request carries
 * the chat's earlier change asks — into its directives and into the hand-off's goal — as
 * CONTEXT: an earlier ask may be done, or superseded by a later one, and the latest
 * message stays authoritative. Questions are never carried, and a run that is not itself
 * a change request carries nothing (the caller gates on `isChangeRequest`), so a
 * question-and-answer chat gets no checklist.
 */

import { asksForChange, isContinuationDirective } from '@builderforce/agent-stall';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { latestUserText, userTextOf } from './convoText';

/**
 * The user turns the PERSON wrote. The transcript also carries `role: 'user'` turns the
 * loop writes itself (a stall nudge, a budget warning), a child's report and an owner's
 * direction, and keeps them across runs, so role alone cannot tell an ask from those.
 * Marked where a person's turn enters the transcript: the persisted seed, the triggering
 * turn, the person's own steer.
 */
const personTurns = new WeakSet<object>();

/** Mark `m` as written by the person (a no-op for any other role). */
export function markPersonTurn(m: ChatCompletionMessage): ChatCompletionMessage {
  if (m.role === 'user') personTurns.add(m);
  return m;
}

/** Asks carried — the most recent ones; an older ask is history the fold already holds. */
const MAX_ASKS = 4;
/** Longest an ask is quoted; a pasted transcript is not the request. */
const MAX_ASK_CHARS = 300;

/**
 * The distinct CHANGE asks in `convo`, oldest first, the latest last. A question is not
 * one; a bare directive ("go", "continue") carries no ask of its own; a repeat of an
 * earlier ask counts once, at its latest position.
 */
export function chatAsks(convo: readonly ChatCompletionMessage[]): string[] {
  const seen = new Set<string>();
  const asks: string[] = [];
  for (let i = convo.length - 1; i >= 0 && asks.length < MAX_ASKS; i--) {
    const m = convo[i];
    if (m?.role !== 'user' || !personTurns.has(m)) continue;
    const text = userTextOf(m).replace(/\s+/g, ' ').trim();
    if (!text || isContinuationDirective(text) || !asksForChange(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    asks.unshift(text.length > MAX_ASK_CHARS ? `${text.slice(0, MAX_ASK_CHARS)}…` : text);
  }
  return asks;
}

const numbered = (asks: readonly string[]): string => asks.map((a, i) => `${i + 1}. ${a}`).join('\n');

/** How a hand-off's goal introduces the earlier asks — context for the slice, not more work. */
const EARLIER_ASKS =
  'Earlier change asks in this chat (oldest first) — CONTEXT ONLY: some may already be done or superseded by a later one. ' +
  'Act on your own task; the request above is authoritative.';

/**
 * The run's GOAL as a hand-off states it to coders who see none of the conversation: the
 * latest message, and — when the chat holds earlier change asks — those, as context.
 */
export function chatGoalText(convo: readonly ChatCompletionMessage[]): string {
  const latest = latestUserText(convo as ChatCompletionMessage[]);
  const asks = chatAsks(convo);
  if (asks.length <= 1) return latest;
  return `${latest}\n\n${EARLIER_ASKS}\n${numbered(asks)}`;
}

/** The run's directive naming the chat's change asks; null when the chat has made one. */
export function chatAsksDirective(convo: readonly ChatCompletionMessage[]): string | null {
  const asks = chatAsks(convo);
  if (asks.length <= 1) return null;
  return (
    'CHANGE ASKS IN THIS CHAT (oldest first). The latest message is authoritative; it continues these, it does not silently drop them. ' +
    'An earlier ask may already be done, or superseded by a later one. Before your final answer, check each against the code: ' +
    'do what is still open and still wanted, and say plainly which are done.\n' +
    numbered(asks)
  );
}
