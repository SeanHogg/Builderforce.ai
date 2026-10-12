/**
 * stepOutbox — the run's durable step rows, sent in batches instead of one POST each.
 *
 * Every tool call, LLM turn and memory step a run takes is ALSO persisted as a
 * `role:'tool'` message (see `persistedSteps.ts` for why). Sent one at a time that is a
 * full `POST /chats/:id/messages` per step — measured on chat #142: 57 tool calls over 22
 * turns, so ~80 requests, each of which costs the API an access check, a membership
 * upsert, the insert, the seq update, the chat touch and an Evermind learn-gate read.
 * The endpoint has always accepted an ARRAY and writes it in ONE insert; nothing about a
 * step row needs its own request.
 *
 * So a step row is QUEUED per chat and leaves:
 *   - riding along with the next conversational send for that chat (assistant text, a
 *     stopped turn, a run failure) — the same request, zero extra calls;
 *   - when the queue reaches {@link STEP_BATCH_MAX} rows;
 *   - {@link STEP_BATCH_WAIT_MS} after the first queued row, at the latest;
 *   - when the run ends ({@link StepBatchingPersistence.flush}).
 *
 * Order is not at risk: every reader sorts steps by the instant recorded in their own
 * metadata (`ts`), never by insert order. Durability semantics are unchanged — step
 * rows were already fire-and-forget, so a batch that fails is dropped exactly as a
 * single row was, and a conversational send that fails still throws to its caller.
 */

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
  const maxRows = opts.maxRows ?? STEP_BATCH_MAX;
  const waitMs = opts.waitMs ?? STEP_BATCH_WAIT_MS;
  const queues = new Map<number, OutgoingMessage[]>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  /** Take a chat's queued rows (and cancel its timer) — the caller sends them. */
  const take = (chatId: number): OutgoingMessage[] => {
    const timer = timers.get(chatId);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(chatId);
    const rows = queues.get(chatId) ?? [];
    queues.delete(chatId);
    return rows;
  };

  const flushChat = async (chatId: number): Promise<void> => {
    const rows = take(chatId);
    if (rows.length === 0) return;
    await base.sendMessages(chatId, rows).catch(() => {
      /* best-effort durability — the live trace already showed these steps */
    });
  };

  const sendMessages = async (chatId: number, messages: OutgoingMessage[]): Promise<BrainMessage[]> => {
    if (messages.length > 0 && messages.every(isStepRow)) {
      const queue = queues.get(chatId) ?? [];
      queue.push(...messages);
      queues.set(chatId, queue);
      if (queue.length >= maxRows) void flushChat(chatId);
      else if (!timers.has(chatId)) timers.set(chatId, setTimeout(() => void flushChat(chatId), waitMs));
      // Nobody reads a step row's saved copy back (it never enters the live list).
      return [];
    }
    const pending = take(chatId);
    if (pending.length === 0) return base.sendMessages(chatId, messages);
    // One request: the queued steps first, then the caller's own messages — whose
    // saved rows (one per input, in order) are what the caller gets back.
    const saved = await base.sendMessages(chatId, [...pending, ...messages]);
    return saved.slice(pending.length);
  };

  return {
    persistence: { ...base, sendMessages },
    async flush() {
      await Promise.all([...queues.keys()].map(flushChat));
    },
  };
}
