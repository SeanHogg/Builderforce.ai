/**
 * WHAT A RATING IS ABOUT — the pure rule that turns "the user pressed 👎 on this
 * reply" into the two facts the learned router needs: WHICH MODEL served the turn,
 * and WHICH MCP TOOL it executed.
 *
 * "Some models are better than others at specific tasks" is only measurable if a
 * rating is filed against the task, and the task a chat turn performed is the tool
 * it called. That association is derivable from the transcript itself: the agent
 * loop persists each tool call as a durable STEP row (see `persistedSteps.ts`) that
 * sits between the user's question and the assistant's answer. Walking back from
 * the rated reply to the steps of ITS turn therefore works after a reload, unlike
 * the in-memory trace, which is empty on a freshly-opened chat.
 *
 * Pure and host-agnostic: the web Brain panel, the Canvas dock and the VS Code
 * webview all mount the same transcript and all call this, so a rating means the
 * same thing wherever it was pressed.
 */

import { parseStepMessage } from './persistedSteps';
import { parseMessageProvenance } from './provenance';
import { isStepMessage } from './types';

/** The minimum message shape this rule needs — every surface's own `BrainMessage`
 *  satisfies it, so nothing has to be converted to call in. */
export interface RatableMessage {
  id: number;
  role: string;
  metadata?: string | null;
}

/** Everything a rating carries beyond the thumb itself. */
export interface RatedTurnContext {
  /** The model the gateway actually resolved for this reply, from its provenance.
   *  Empty when the turn predates provenance — the caller must then skip the
   *  rating rather than attribute it to a guess. */
  model: string;
  /** The MCP tool the rated turn executed, or null for a prose-only reply. */
  toolName: string | null;
}

/**
 * The tool a rated turn executed. Walks BACK from the reply over the durable step
 * rows that belong to the same turn (they sit between it and the previous
 * conversation message) and returns the LAST tool step — the one whose result the
 * reply is actually reporting on, and therefore the one being judged.
 *
 * Returns null for a turn that called nothing. That is a real and common case, and
 * a rating with no tool is still evidence about the model: "it answered badly" is a
 * verdict, and forcing it into some tool's bucket would libel that tool.
 */
export function ratedTurnTool(messages: readonly RatableMessage[], messageId: number): string | null {
  const index = messages.findIndex((m) => m.id === messageId);
  if (index < 0) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    // A non-step message is the previous conversation turn — stop; anything before
    // it belongs to a different exchange.
    if (!isStepMessage(message)) return null;
    const parsed = parseStepMessage(message.metadata ?? null);
    if (parsed?.step.category === 'tool') return parsed.step.label || null;
  }
  return null;
}

/**
 * Build the full rating context for one assistant reply. `model` comes from the
 * reply's own persisted provenance, so it is the id the gateway resolved after any
 * failover — never the model the composer happened to be showing.
 */
export function ratedTurnContext(messages: readonly RatableMessage[], messageId: number): RatedTurnContext {
  const message = messages.find((m) => m.id === messageId);
  return {
    model: (message && parseMessageProvenance(message)?.model) || '',
    toolName: ratedTurnTool(messages, messageId),
  };
}

/** What a thumb tells the E5 local-success label: the verdict on chat `chatId`'s latest reply. */
export interface LocalRatingVerdict {
  chatId: number;
  passed: boolean;
}

/**
 * The E5 `rating` verdict a thumb carries, or null when it carries none. Only a thumb
 * on the chat's LATEST reply judges the turn the local-success label is waiting on —
 * a press on an older reply (or clearing a thumb) says nothing about it, and the
 * deferred registry resolves by chat, so it must never be handed an older verdict.
 */
export function localRatingVerdict(
  messages: readonly RatableMessage[],
  messageId: number,
  rating: 1 | -1 | 0,
  chatId: number | null,
): LocalRatingVerdict | null {
  if (rating === 0 || chatId == null) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role !== 'assistant' || isStepMessage(message)) continue;
    return message.id === messageId ? { chatId, passed: rating === 1 } : null;
  }
  return null;
}

/** One viewer's thumb per message id — the shape every transcript's `ratings` prop takes. */
export type MessageRatings = Record<number, 1 | -1>;

/**
 * The optimistic update a thumb press makes to that map: `0` clears the message's
 * verdict, `1`/`-1` sets it. Pure so every surface that rates a reply (the web Brain
 * panel through `useBrainConversation`, the Canvas dock) moves its thumbs the same way
 * before the best-effort write lands.
 */
export function withRating(ratings: MessageRatings, messageId: number, rating: 1 | -1 | 0): MessageRatings {
  const next = { ...ratings };
  if (rating === 0) delete next[messageId];
  else next[messageId] = rating;
  return next;
}
