/**
 * Execution steering thread — the single source of truth for persisting and
 * draining the per-execution chat thread (migration 0109 `execution_messages`).
 *
 * Why this exists: a user "Send" on the execution Output tab used to only forward
 * to a live self-hosted host and was a silent no-op for cloud runs (and for any
 * terminal run). The WS echo it relied on is per-Worker-isolate, so a steer often
 * never reached the agent and vanished on reload. Persisting the thread makes
 * steering durable + cross-isolate:
 *   • {@link enqueueExecutionMessage} records a turn (user steer / assistant reply).
 *   • {@link pullPendingSteering} drains the unconsumed USER steers for a run and
 *     stamps them consumed — called at the top of each cloud agent loop step so a
 *     steer is delivered into the live conversation exactly once.
 *   • {@link listExecutionMessages} returns the full thread for the trace view.
 *
 * Every function is best-effort on write/read failure (telemetry-grade) so it can
 * never break a run, mirroring the recordCloud* helpers.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executionMessages } from '../../infrastructure/database/schema';

export type ExecutionMessageRole = 'user' | 'assistant';

export interface ExecutionMessageRow {
  role: ExecutionMessageRole;
  text: string;
  ts: string;
}

/**
 * Persist one turn of an execution's thread. Returns false (never throws) on
 * failure. A user turn defaults to PENDING (the cloud loop will drain it as a
 * steer); pass `pending: false` to record a display-only echo — e.g. the directive
 * that SEEDED a brand-new run (it is already in that run's prompt, so it must not
 * be re-injected as a steer). Assistant turns are always history-only.
 */
export async function enqueueExecutionMessage(
  db: Db,
  args: { executionId: number; tenantId: number; role: ExecutionMessageRole; text: string; pending?: boolean },
): Promise<boolean> {
  const text = args.text.trim();
  if (!text) return false;
  const pending = args.role === 'user' && (args.pending ?? true);
  try {
    await db.insert(executionMessages).values({
      executionId: args.executionId,
      tenantId: args.tenantId,
      role: args.role,
      text,
      consumedAt: pending ? null : new Date(),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Drain the pending (unconsumed) user steers for a run and mark them consumed in
 * the same call, so the cloud agent loop ingests each steer exactly once. Returns
 * the steer texts oldest-first (the order the user sent them). Empty on no pending
 * steers or any error — the loop simply proceeds without injecting a turn.
 */
export async function pullPendingSteering(db: Db, executionId: number): Promise<string[]> {
  try {
    const rows = await db
      .select({ text: executionMessages.text })
      .from(executionMessages)
      .where(and(
        eq(executionMessages.executionId, executionId),
        eq(executionMessages.role, 'user'),
        isNull(executionMessages.consumedAt),
      ))
      .orderBy(asc(executionMessages.createdAt));
    if (rows.length === 0) return [];
    // Stamp consumed before returning so a later tick can't re-deliver the same steer.
    await db.update(executionMessages)
      .set({ consumedAt: new Date() })
      .where(and(eq(executionMessages.executionId, executionId), isNull(executionMessages.consumedAt)));
    return rows.map((r) => r.text).filter((t) => t.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Mark every still-pending user steer for an execution as consumed. Called when a
 * run reaches a terminal state so a steer posted in the narrow window between the
 * loop's last step and the status flip is never left dangling (it can no longer be
 * delivered to a stopped loop). Idempotent + best-effort. Returns how many it released.
 */
export async function releasePendingSteers(db: Db, executionId: number): Promise<number> {
  try {
    const pending = await db
      .select({ id: executionMessages.id })
      .from(executionMessages)
      .where(and(eq(executionMessages.executionId, executionId), isNull(executionMessages.consumedAt)));
    if (pending.length === 0) return 0;
    await db.update(executionMessages)
      .set({ consumedAt: new Date() })
      .where(and(eq(executionMessages.executionId, executionId), isNull(executionMessages.consumedAt)));
    return pending.length;
  } catch {
    return 0;
  }
}

/** The full persisted thread for an execution, oldest-first, for the trace view. */
export async function listExecutionMessages(db: Db, executionId: number): Promise<ExecutionMessageRow[]> {
  try {
    const rows = await db
      .select({ role: executionMessages.role, text: executionMessages.text, ts: executionMessages.createdAt })
      .from(executionMessages)
      .where(eq(executionMessages.executionId, executionId))
      .orderBy(asc(executionMessages.createdAt))
      .limit(500);
    return rows.map((r) => ({
      role: r.role === 'assistant' ? 'assistant' : 'user',
      text: r.text,
      ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    }));
  } catch {
    return [];
  }
}
