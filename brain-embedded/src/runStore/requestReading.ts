/**
 * What the person's request MEANS for this run, read once in the preamble: their own
 * words, the directives those words imply, and the goal a hand-off states to coders.
 *
 *   - A bare "Fix" / "do it" / "go ahead" has no subject of its own — it points at the
 *     proposal in the previous assistant turn. Read as a fresh, contextless request it is
 *     genuinely ambiguous, and the model then does the reasonable-looking thing: it asks
 *     what to fix, while the answer sits one message above it. Resolved HERE rather than
 *     left to the model to notice, because the connection is structural and cheap to
 *     verify — a contentless directive landing directly on a turn that promised
 *     unfinished work — and a model that misreads it burns a whole turn asking.
 *   - A change request carries the chat's earlier change asks, so a follow-up never drops
 *     the work it follows (`chatAsks.ts`).
 *
 * The caller places the directives (per-turn block or system prompt); this decides them.
 */

import { continuationDirective, isContinuationDirective, promisesUnfinishedWork } from '@builderforce/agent-stall';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import type { RunCell } from './runCell';
import { nowIso, pushTrace } from './runCells';
import { lastAssistantText, latestUserText } from './convoText';
import { chatAsksDirective, chatGoalText } from './chatAsks';
import { isChangeRequest } from './progressBudget';

export interface RequestReading {
  /**
   * The person's OWN request for this run, captured once. Every later read of the
   * transcript would find the loop's own recovery nudge instead — and the handoff gate in
   * the final-answer hook asks "did the USER ask for a change?", a question a nudge
   * cannot answer.
   */
  userRequest: string;
  /** Directives the request implies, in order — none for most requests. */
  directives: string[];
  /** The goal a hand-off states to coders who see none of this chat. */
  goal: string;
}

export function readRequest(c: RunCell, convo: ChatCompletionMessage[], mode: string | undefined): RequestReading {
  const userRequest = latestUserText(convo);
  const directives: string[] = [];
  if (isContinuationDirective(userRequest) && promisesUnfinishedWork(lastAssistantText(convo))) {
    directives.push(continuationDirective());
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'turn.continuation_resolved',
      result: "The user's bare directive was resolved against the previous turn's unfinished proposal, so the run carries that proposal out instead of asking what to fix.",
    });
  }
  const changeRequest = isChangeRequest(mode, userRequest);
  const asks = changeRequest ? chatAsksDirective(convo) : null;
  if (asks) directives.push(asks);
  return { userRequest, directives, goal: changeRequest ? chatGoalText(convo) : userRequest };
}
