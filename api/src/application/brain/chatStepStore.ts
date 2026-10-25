/**
 * THE STEP STORE — where a Brain run's steps (tool calls, LLM turns, memory steps) live.
 *
 * Steps are run telemetry, so they are written to the OPERATIONAL endpoint
 * (`brain_chat_steps` via {@link runTelemetryDatabase}), never to core's
 * `brain_chat_messages`. The conversation and its steps are still ONE transcript to a
 * client: every step is handed back shaped as the `role:'tool'` message it always was
 * ({@link toMessageRow}), with `seq: 0` so it can never advance a poller's seq cursor.
 *
 * Writers: `appendRaw` (web + VS Code runs, the server's addressed-agent reply) and the
 * VS Code sync importer. Reader: the transcript tail (`getMessages` → {@link mergeSteps}).
 */

import { and, asc, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { brainChatSteps, STEP_ID_FLOOR } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import type { BrainChatMessageRow } from './brainChatShapes';

/** A step as a writer hands it over — the `role:'tool'` message shape. */
export interface StepInput {
  metadata: string;
  eventKey?: string | null;
  createdAt?: Date;
}

/** Most steps a transcript read merges back — a run can take thousands; the reader only
 *  ever renders the window of messages it was asked for. */
export const MERGED_STEPS_MAX = 2000;

type StepRow = typeof brainChatSteps.$inferSelect;

/** A stored step, as the transcript row clients have always received. */
export function toMessageRow(step: Pick<StepRow, 'id' | 'metadata' | 'createdAt'>): BrainChatMessageRow {
  return { id: step.id, role: 'tool', content: '', metadata: step.metadata, seq: 0, createdAt: step.createdAt };
}

/** Whether a message id names a step (ids above the floor live in `brain_chat_steps`). */
export function isStepId(id: number): boolean {
  return id >= STEP_ID_FLOOR;
}

/**
 * Append steps to a chat, idempotent on `(chat_id, event_key)` exactly like the message
 * write: a retried step returns the row the first attempt wrote. Order is preserved.
 */
export async function appendSteps(core: Db, tenantId: number, chatId: number, steps: readonly StepInput[]): Promise<BrainChatMessageRow[]> {
  if (steps.length === 0) return [];
  const db = runTelemetryDatabase(core);
  const written = await db
    .insert(brainChatSteps)
    .values(steps.map((s) => ({
      tenantId,
      chatId,
      metadata: s.metadata,
      eventKey: s.eventKey ?? null,
      ...(s.createdAt ? { createdAt: s.createdAt } : {}),
    })))
    .onConflictDoNothing({
      target: [brainChatSteps.chatId, brainChatSteps.eventKey],
      where: isNotNull(brainChatSteps.eventKey),
    })
    .returning({ id: brainChatSteps.id, metadata: brainChatSteps.metadata, createdAt: brainChatSteps.createdAt, eventKey: brainChatSteps.eventKey });
  if (written.length === steps.length) return written.map(toMessageRow);

  // Some keyed steps were already there: answer them with the original rows, in order.
  const keys = steps.map((s) => s.eventKey).filter((k): k is string => !!k);
  const existing = keys.length === 0 ? [] : await db
    .select({ id: brainChatSteps.id, metadata: brainChatSteps.metadata, createdAt: brainChatSteps.createdAt, eventKey: brainChatSteps.eventKey })
    .from(brainChatSteps)
    .where(and(eq(brainChatSteps.chatId, chatId), inArray(brainChatSteps.eventKey, keys)));
  const byKey = new Map(existing.map((r) => [r.eventKey, r]));
  const fresh = written.filter((r) => !r.eventKey);
  let next = 0;
  const out: BrainChatMessageRow[] = [];
  for (const s of steps) {
    const row = s.eventKey ? byKey.get(s.eventKey) : fresh[next++];
    if (row) out.push(toMessageRow(row));
  }
  return out;
}

/** A chat's steps at or after `since` (all of them when null), newest `MERGED_STEPS_MAX`. */
export async function readSteps(core: Db, chatId: number, since: Date | null): Promise<BrainChatMessageRow[]> {
  const rows = await runTelemetryDatabase(core)
    .select({ id: brainChatSteps.id, metadata: brainChatSteps.metadata, createdAt: brainChatSteps.createdAt })
    .from(brainChatSteps)
    .where(since ? and(eq(brainChatSteps.chatId, chatId), gte(brainChatSteps.createdAt, since)) : eq(brainChatSteps.chatId, chatId))
    .orderBy(desc(brainChatSteps.createdAt), desc(brainChatSteps.id))
    .limit(MERGED_STEPS_MAX);
  return rows.reverse().map(toMessageRow);
}

/**
 * Interleave a chat's steps into a window of its messages by time. Stable: a message
 * and a step at the same instant keep the message first.
 */
export function interleaveByTime(messages: readonly BrainChatMessageRow[], steps: readonly BrainChatMessageRow[]): BrainChatMessageRow[] {
  if (steps.length === 0) return [...messages];
  const out: BrainChatMessageRow[] = [];
  let i = 0;
  let j = 0;
  while (i < messages.length || j < steps.length) {
    if (j >= steps.length || (i < messages.length && messages[i].createdAt.getTime() <= steps[j].createdAt.getTime())) out.push(messages[i++]);
    else out.push(steps[j++]);
  }
  return out;
}

/** The transcript tail with its steps merged back in. A TRUNCATED tail only takes steps
 *  from its oldest message on — older ones belong to messages the reader did not ask for. */
export async function mergeSteps(core: Db, chatId: number, messages: readonly BrainChatMessageRow[], truncated: boolean): Promise<BrainChatMessageRow[]> {
  const windowStart = truncated && messages.length > 0 ? messages[0].createdAt : null;
  const steps = await readSteps(core, chatId, windowStart);
  return interleaveByTime(messages, steps);
}

/** Copy a set of chats' steps onto another chat (chat consolidation). Returns the count. */
export async function copySteps(core: Db, tenantId: number, sourceChatIds: readonly number[], targetChatId: number): Promise<number> {
  if (sourceChatIds.length === 0) return 0;
  const db = runTelemetryDatabase(core);
  const rows = await db
    .select({ metadata: brainChatSteps.metadata, eventKey: brainChatSteps.eventKey, createdAt: brainChatSteps.createdAt })
    .from(brainChatSteps)
    .where(and(eq(brainChatSteps.tenantId, tenantId), inArray(brainChatSteps.chatId, [...sourceChatIds])))
    .orderBy(asc(brainChatSteps.createdAt));
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(brainChatSteps)
    .values(rows.map((r) => ({ tenantId, chatId: targetChatId, metadata: r.metadata, eventKey: r.eventKey, createdAt: r.createdAt })))
    .onConflictDoNothing()
    .returning({ id: brainChatSteps.id });
  return inserted.length;
}

/** Rewrite one step's metadata (a synced feedback edit). Null when no such step. */
export async function updateStep(core: Db, chatId: number, stepId: number, metadata: string): Promise<number | null> {
  const [row] = await runTelemetryDatabase(core)
    .update(brainChatSteps)
    .set({ metadata })
    .where(and(eq(brainChatSteps.id, stepId), eq(brainChatSteps.chatId, chatId)))
    .returning({ id: brainChatSteps.id });
  return row?.id ?? null;
}

/** Delete one step of a chat. */
export async function deleteStep(core: Db, chatId: number, stepId: number): Promise<void> {
  await runTelemetryDatabase(core).delete(brainChatSteps).where(and(eq(brainChatSteps.id, stepId), eq(brainChatSteps.chatId, chatId)));
}
