/**
 * Persistence for LATE steers — a user steer that lands after its run's last turn.
 *
 * The steering thread (`executionSteering.ts`) queues and drains steers for a LIVE run.
 * This module owns the other end of a steer's life: the one-shot CLAIM that turns an
 * undelivered steer into a follow-up run, and the record of what became of it. It is
 * separate because the two have different invariants — a drain may happen on every
 * loop step, a claim happens exactly once per steer, ever (`late_claimed_at`), and that
 * once is the idempotency guarantee a retried frame relies on.
 *
 * Every query is scoped by `execution_id`; the caller has already proved the execution
 * belongs to the tenant (see `lateSteerFollowUp.ts`).
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executionMessages } from '../../infrastructure/database/schema';
import type { LateSteerOutcomeKind } from './executionSteering';

/** One late steer, as claimed. `sentBy` is the person the follow-up runs under. */
export interface ClaimedSteer {
  id: number;
  text: string;
  sentBy: string | null;
}

/** A steer as a runtime reports it back: the row id when the frame carried one, else its text. */
export interface ReportedSteer {
  messageId?: number;
  text: string;
}

/**
 * A steer the API relayed to a live self-hosted run is that host's to deliver from
 * then on: it either applies it (`steer.applied`) or reports it back as late. Marking
 * it consumed here is what stops the terminal chokepoint from ALSO treating an applied
 * steer as undelivered and starting a follow-up for work the run already did.
 */
export async function markSteerRelayed(db: Db, messageId: number): Promise<void> {
  await db.update(executionMessages)
    .set({ consumedAt: new Date() })
    .where(and(eq(executionMessages.id, messageId), isNull(executionMessages.consumedAt)));
}

/**
 * Hand reported steers back to the pending queue of a run that is STILL LIVE — the
 * host saw no run for them (a cloud fallback, a restart) or reported before its own
 * terminal state landed. Pending, they are drained by the live loop or claimed by the
 * run's terminal chokepoint; either way they are not lost. Never touches a claimed row.
 */
export async function repend(db: Db, executionId: number, messageIds: readonly number[]): Promise<void> {
  if (messageIds.length === 0) return;
  await db.update(executionMessages)
    .set({ consumedAt: null })
    .where(and(
      eq(executionMessages.executionId, executionId),
      eq(executionMessages.role, 'user'),
      inArray(executionMessages.id, [...messageIds]),
      isNull(executionMessages.lateClaimedAt),
    ));
}

/**
 * THE idempotency point. Atomically claim late steers for a follow-up: with ids, those
 * rows (a runtime's report); without, every still-pending user steer of the run (the
 * terminal chokepoint). One UPDATE … WHERE late_claimed_at IS NULL … RETURNING, so two
 * concurrent callers can never both claim the same steer — the second gets nothing and
 * dispatches nothing. Oldest first: the order the person sent them.
 */
export async function claimLateSteers(db: Db, executionId: number, messageIds?: readonly number[]): Promise<ClaimedSteer[]> {
  const now = new Date();
  const rows = await db.update(executionMessages)
    .set({ lateClaimedAt: now, consumedAt: now })
    .where(and(
      eq(executionMessages.executionId, executionId),
      eq(executionMessages.role, 'user'),
      isNull(executionMessages.lateClaimedAt),
      messageIds ? inArray(executionMessages.id, [...messageIds]) : isNull(executionMessages.consumedAt),
    ))
    .returning({ id: executionMessages.id, text: executionMessages.text, sentBy: executionMessages.sentBy });
  return rows.sort((a, b) => a.id - b.id);
}

/** What an already-claimed steer became — the answer to a duplicate report. */
export async function lateSteerOutcomeOf(
  db: Db,
  executionId: number,
  messageIds: readonly number[],
): Promise<{ outcome: LateSteerOutcomeKind | null; followUpExecutionId: number | null } | null> {
  if (messageIds.length === 0) return null;
  const [row] = await db
    .select({ outcome: executionMessages.lateOutcome, followUpExecutionId: executionMessages.followUpExecutionId })
    .from(executionMessages)
    .where(and(
      eq(executionMessages.executionId, executionId),
      inArray(executionMessages.id, [...messageIds]),
      isNotNull(executionMessages.lateClaimedAt),
    ))
    .limit(1);
  return row ? { outcome: (row.outcome as LateSteerOutcomeKind | null) ?? null, followUpExecutionId: row.followUpExecutionId ?? null } : null;
}

/** Record what the claimed steers became, so the thread can say so. */
export async function recordLateSteerOutcome(
  db: Db,
  messageIds: readonly number[],
  outcome: { outcome: LateSteerOutcomeKind; followUpExecutionId?: number | null; detail?: string | null },
): Promise<void> {
  if (messageIds.length === 0) return;
  await db.update(executionMessages)
    .set({
      lateOutcome: outcome.outcome,
      followUpExecutionId: outcome.followUpExecutionId ?? null,
      lateDetail: outcome.detail ? outcome.detail.slice(0, 1000) : null,
    })
    .where(inArray(executionMessages.id, [...messageIds]));
}

/**
 * Map a runtime's report onto this run's steer rows. A frame that carried a row id is
 * trusted only if the row is a user steer of THIS execution; a frame without one (sent
 * by an API that predates the id) is matched to the newest unclaimed steer with its text.
 */
export async function resolveReportedSteerIds(db: Db, executionId: number, steers: readonly ReportedSteer[]): Promise<number[]> {
  const byId = steers.map((s) => s.messageId).filter((n): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0);
  const byText = [...new Set(steers.filter((s) => s.messageId == null).map((s) => s.text.trim()).filter(Boolean))];
  const ids = new Set<number>();
  if (byId.length > 0) {
    const rows = await db.select({ id: executionMessages.id }).from(executionMessages)
      .where(and(eq(executionMessages.executionId, executionId), eq(executionMessages.role, 'user'), inArray(executionMessages.id, byId)));
    for (const r of rows) ids.add(r.id);
  }
  if (byText.length > 0) {
    const rows = await db.select({ id: executionMessages.id, text: executionMessages.text }).from(executionMessages)
      .where(and(
        eq(executionMessages.executionId, executionId),
        eq(executionMessages.role, 'user'),
        isNull(executionMessages.lateClaimedAt),
        inArray(executionMessages.text, byText),
      ))
      .orderBy(desc(executionMessages.createdAt));
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.text)) continue;
      seen.add(r.text);
      ids.add(r.id);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

/** Of these executions, the ones holding a still-pending user steer (one query, for sweeps). */
export async function executionsWithPendingSteers(db: Db, executionIds: readonly number[]): Promise<number[]> {
  if (executionIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ executionId: executionMessages.executionId })
    .from(executionMessages)
    .where(and(
      inArray(executionMessages.executionId, [...executionIds]),
      eq(executionMessages.role, 'user'),
      isNull(executionMessages.consumedAt),
    ))
    .orderBy(asc(executionMessages.executionId));
  return rows.map((r) => r.executionId);
}
