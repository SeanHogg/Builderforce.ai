/**
 * THE STEP STORE — where a Brain run's steps (tool calls, LLM turns, memory steps) live.
 *
 * Steps are run telemetry, so they are written to the OPERATIONAL endpoint
 * (`brain_chat_steps` via {@link runTelemetryDatabase}), never to core's
 * `brain_chat_messages`. The conversation and its steps are still ONE transcript to a
 * client: every step is handed back shaped as the `role:'tool'` message it always was
 * ({@link toMessageRow}), carrying the seq of the conversation row it sits before
 * ({@link anchorStepSeqs}) — never a seq of its own, so it cannot advance a poller's
 * cursor, and a client's stable seq sort keeps it where it happened.
 *
 * Writers: `appendRaw` (web + VS Code runs, the server's addressed-agent reply) and the
 * VS Code sync importer. Reader: the transcript tail (`getMessages` → {@link mergeSteps}).
 */

import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { brainChatSteps, STEP_ID_FLOOR } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
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
    .where(scopedToTenant(brainChatSteps, tenantId, eq(brainChatSteps.chatId, chatId), inArray(brainChatSteps.eventKey, keys)));
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
 * Give each step in an ordered transcript the seq of the conversation row after it
 * (a run's steps precede its reply), or — for steps nothing follows yet, a run still
 * going — of the row before it, `before` when there is none. Clients order a merged
 * transcript by seq with a stable sort; an anchored step therefore stays where it
 * happened instead of sorting to the top. ONE rule for the write answer and the read.
 */
export function anchorStepSeqs(rows: readonly BrainChatMessageRow[], before: number): BrainChatMessageRow[] {
  const out = [...rows];
  let next: number | null = null;
  for (let k = out.length - 1; k >= 0; k--) {
    const row = out[k]!;
    if (!isStepId(row.id)) next = row.seq;
    else if (next !== null) out[k] = { ...row, seq: next };
  }
  let prev = before;
  for (let k = 0; k < out.length; k++) {
    const row = out[k]!;
    if (!isStepId(row.id)) prev = row.seq;
    else if (row.seq === 0) out[k] = { ...row, seq: prev };
  }
  return out;
}

/**
 * Interleave a chat's steps into a window of its messages by time, steps anchored
 * ({@link anchorStepSeqs}). Stable: a message and a step at the same instant keep the
 * message first. Both halves of one write share one clock (`appendRaw`), so a run's
 * steps sort before the reply written with them.
 */
export function interleaveByTime(messages: readonly BrainChatMessageRow[], steps: readonly BrainChatMessageRow[]): BrainChatMessageRow[] {
  if (steps.length === 0) return [...messages];
  const out: BrainChatMessageRow[] = [];
  let i = 0;
  let j = 0;
  for (;;) {
    const message = messages[i];
    const step = steps[j];
    if (!message && !step) return anchorStepSeqs(out, 0);
    if (message && (!step || message.createdAt.getTime() <= step.createdAt.getTime())) { out.push(message); i++; }
    else if (step) { out.push(step); j++; }
  }
}

/** The transcript tail with its steps merged back in. A TRUNCATED tail only takes steps
 *  from its oldest message on — older ones belong to messages the reader did not ask for. */
export async function mergeSteps(core: Db, chatId: number, messages: readonly BrainChatMessageRow[], truncated: boolean): Promise<BrainChatMessageRow[]> {
  const windowStart = truncated ? messages[0]?.createdAt ?? null : null;
  const steps = await readSteps(core, chatId, windowStart);
  return interleaveByTime(messages, steps);
}

/**
 * Copy a set of chats' steps onto another chat (chat consolidation), keeping their
 * times so they interleave with the copied conversation. ONE `INSERT … SELECT` on the
 * step store: a long chat has thousands of steps, which as bound VALUES would pass
 * Postgres's parameter limit. Returns the count.
 */
export async function copySteps(core: Db, tenantId: number, sourceChatIds: readonly number[], targetChatId: number): Promise<number> {
  if (sourceChatIds.length === 0) return 0;
  const result = await runTelemetryDatabase(core).execute(sql`
    INSERT INTO ${brainChatSteps} (tenant_id, chat_id, metadata, event_key, created_at)
    SELECT ${brainChatSteps.tenantId}, ${targetChatId}, ${brainChatSteps.metadata}, ${brainChatSteps.eventKey}, ${brainChatSteps.createdAt}
    FROM ${brainChatSteps}
    WHERE ${scopedToTenant(brainChatSteps, tenantId, inArray(brainChatSteps.chatId, [...sourceChatIds]))}
    ORDER BY ${brainChatSteps.createdAt}
    ON CONFLICT DO NOTHING
  `);
  return Number((result as unknown as { rowCount?: number }).rowCount ?? 0);
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
