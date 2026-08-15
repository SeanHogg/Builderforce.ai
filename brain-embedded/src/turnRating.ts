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
