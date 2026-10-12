/**
 * stepOutbox — the run's durable step rows, sent in batches instead of one POST each.
 *
 * Every tool call, LLM turn and memory step a run takes is persisted as a `role:'tool'`
 * message (see `persistedSteps.ts`). Sent one at a time that was a full
 * `POST /chats/:id/messages` per step — measured on chat #142: 57 tool calls over 22
 * turns, ~80 requests, each costing the API an access check, a membership upsert, the
 * insert, the seq update, the chat touch and a learn-gate read. The endpoint writes an
 * ARRAY in one insert; nothing about a step row needs its own request.
 *
 * So step rows go through the shared write outbox (`@builderforce/write-outbox`), one
 * lane per chat, and leave:
 *   - riding along with the next conversational send for that chat (assistant text, a
 *     stopped turn, a run failure) — the same request, zero extra calls;
 *   - when {@link STEP_BATCH_MAX} rows are queued;
 *   - {@link STEP_BATCH_WAIT_MS} after the first queued row, at the latest;
 *   - when the run ends ({@link StepBatchingPersistence.flush}).
 *
 * ORDER holds by construction: a chat's lane has one request in flight at a time, and a
 * conversational send waits its turn in that lane, so nothing it writes can overtake a
 * step batch already on the wire. Durability is unchanged — a failed step batch is
 * dropped exactly as a single row was; a failed conversational send still throws.
 */

import { createOutbox } from '@builderforce/write-outbox';
import type { BrainMessage } from './types';

type OutgoingMessage = { role: string; content: string; metadata?: string };

/** The persistence port this wraps — the slice of `BrainRunPersistence` it needs. */
export interface StepPersistence {
  sendMessages(chatId: number, messages: OutgoingMessage[]): Promise<BrainMessage[]>;
}

export interface StepBatchingPersistence<P extends StepPersistence> {
  readonly persistence: P;
  /** Send every queued step row now (all chats). Never throws. */
  flush(): Promise<void>;
}

/** Rows per batch before it leaves without waiting. A step row is capped at ~4 KB. */
export const STEP_BATCH_MAX = 25;
/** The longest a queued step row waits for a ride. */
export const STEP_BATCH_WAIT_MS = 5_000;

/** A step row: the only `role:'tool'` message a run persists. */
const isStepRow = (m: OutgoingMessage): boolean => m.role === 'tool';

export function batchStepPersistence<P extends StepPersistence>(
  base: P,
  opts: { maxRows?: number; waitMs?: number } = {},
): StepBatchingPersistence<P> {
  const steps = createOutbox<OutgoingMessage, number>({
    maxItems: opts.maxRows ?? STEP_BATCH_MAX,
    maxWaitMs: opts.waitMs ?? STEP_BATCH_WAIT_MS,
    send: (chatId, rows) => base.sendMessages(chatId, rows),
  });

  const sendMessages = async (chatId: number, messages: OutgoingMessage[]): Promise<BrainMessage[]> => {
    if (messages.length > 0 && messages.every(isStepRow)) {
      for (const m of messages) steps.enqueue(chatId, m);
      // Nobody reads a step row's saved copy back (it never enters the live list).
      return [];
    }
    // One request, in the chat's order: the queued steps first, then the caller's own
    // messages — whose saved rows (one per input, in order) are what the caller gets.
    return steps.drainWith(chatId, async (pending) => {
      if (pending.length === 0) return base.sendMessages(chatId, messages);
      const saved = await base.sendMessages(chatId, [...pending, ...messages]);
      return saved.slice(pending.length);
    });
  };

  return {
    persistence: { ...base, sendMessages },
    flush: () => steps.flush(),
  };
}
