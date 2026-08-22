/**
 * POINTS FRAUD — the heuristics, and the queue they raise into.
 *
 * ── THE ATTACK THIS EXISTS FOR ───────────────────────────────────────────────
 * Author a hundred tasks, close them all, cash the points out. The earning gate
 * (`USER_TASK_GATE_THRESHOLD`) blunts it — self-authored tasks pay nothing until
 * a hundred have been closed — but the gate is a speed bump, not a detector: it
 * caps the damage of the first hundred and says nothing about the next thousand.
 * These heuristics are the detector, and they run only on the action the attack
 * uses, because a detector that runs on every award is a detector that costs a
 * query on every award.
 *
 * ── WHY A FLAG IS AN `alert_events` ROW ──────────────────────────────────────
 * Because it is a firing: something crossed a threshold, a human should look, and
 * the outcome is acknowledged-or-resolved. That is the lifecycle `alert_events`
 * already owns, along with its operator surface, so migration 1106 gave it the
 * four columns it was missing (a subject, a severity, an evidence payload) rather
 * than standing up a `points_fraud_flags` table beside it with the same shape and
 * a second review queue nobody would remember to work.
 *
 * (The coverage map files `points_fraud_flags` under `ledger_entry`. That is a
 * bulk-assignment artifact and it is wrong: a flag has no amount and no
 * denomination, and putting it in the table every balance sums over would be a
 * correctness bug, not just a taxonomy one. The map is corrected alongside this.)
 *
 * ── SEVERITY DECIDES SUSPENSION, NOT THE CALLER ──────────────────────────────
 * A `high` flag suspends earning immediately and a `medium` one does not. That
 * rule lives on the flag, so the writer cannot forget to apply it and an operator
 * reading the queue can see why an account stopped earning without cross-
 * referencing anything.
 */

import { and, eq, gte, like, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { alertEvents, ledgerEntries } from '../../infrastructure/database/schema';
import { POINTS } from '../kernel/denominations';
import { POINT_ACTIONS } from './pointsCatalog';
import { invalidatePointsCaches } from './pointsLedger';
import { writePointsProfile, type PointsProfile } from './pointsProfile';

/** The metric name every points-fraud firing is filed under, so the alerts
 *  surface can select them without knowing the individual heuristics. */
export const POINTS_FRAUD_METRIC = 'points_fraud';

export type FraudSeverity = 'low' | 'medium' | 'high';

export interface FraudFlag {
  kind: string;
  severity: FraudSeverity;
  summary: string;
  evidence: Record<string, unknown>;
}

/** The pre-aggregated shape the rules read. Separated from the query below so
 *  the thresholds can be tested against literals. */
export interface FraudInput {
  /** Highest number of self-authored task completions inside any one minute of
   *  the last half hour. */
  peakClosesPerMinute: number;
  /** Self-authored task completions in the last hour. */
  closesLastHour: number;
}

/**
 * The rules. Two, deliberately — the source product carried five, and three of
 * them (signup-IP clustering, device-fingerprint clustering, refund-then-redeem)
 * read signals this platform does not collect. Shipping them here would have
 * meant three heuristics that can never fire, which reads as coverage and is
 * not. They are recorded in the gap register instead.
 */
export function fraudFlagsFor(input: FraudInput): FraudFlag[] {
  const flags: FraudFlag[] = [];

  if (input.peakClosesPerMinute >= 20) {
    flags.push({
      kind: 'bulk_close_burst',
      severity: 'high',
      summary: `Closed ${input.peakClosesPerMinute} self-authored tasks inside one minute.`,
      evidence: { peakClosesPerMinute: input.peakClosesPerMinute, windowMinutes: 30 },
    });
  }

  if (input.closesLastHour > 60) {
    flags.push({
      kind: 'sustained_closure_spike',
      severity: 'medium',
      summary: `Closed ${input.closesLastHour} self-authored tasks in the last hour.`,
      evidence: { closesLastHour: input.closesLastHour },
    });
  }

  return flags;
}

/**
 * Aggregate the ledger and apply the rules. ONE query: the per-minute peak and
 * the hourly total come from the same half-hour scan, because two queries over
 * the same rows is two chances to disagree about the window.
 */
export async function evaluateFraud(db: Db, tenantId: number, userId: string): Promise<FraudFlag[]> {
  const since = new Date(Date.now() - 3_600_000);
  const minute = sql<string>`date_trunc('minute', ${ledgerEntries.occurredAt})`;

  const buckets = await db
    .select({ minute, n: sql<string>`count(*)` })
    .from(ledgerEntries)
    .where(and(
      eq(ledgerEntries.tenantId, tenantId),
      eq(ledgerEntries.accountKind, 'user'),
      eq(ledgerEntries.accountRef, userId),
      eq(ledgerEntries.denomination, POINTS),
      like(ledgerEntries.reference, `pts:${userId}:${POINT_ACTIONS.TASK_COMPLETE_USER}:%`),
      gte(ledgerEntries.occurredAt, since),
    ))
    .groupBy(minute);

  const counts = buckets.map((row) => Number(row.n));
  return fraudFlagsFor({
    peakClosesPerMinute: counts.length ? Math.max(...counts) : 0,
    closesLastHour: counts.reduce((sum, n) => sum + n, 0),
  });
}

/**
 * Raise the flags and suspend when any of them is `high`.
 *
 * Idempotent per (user, kind, hour): the same burst re-evaluated on the next
 * award must not fill the queue with a hundred identical rows. The hour bucket
 * is the dedupe key because a burst that is still running an hour later is
 * genuinely new information a reviewer should see.
 */
export async function recordFraudFlags(
  db: Db, env: Env,
  input: { tenantId: number; userId: string; flags: FraudFlag[]; profile: PointsProfile },
): Promise<void> {
  const hour = new Date().toISOString().slice(0, 13);

  for (const flag of input.flags) {
    const already = await db.select({ id: alertEvents.id })
      .from(alertEvents)
      .where(and(
        eq(alertEvents.tenantId, input.tenantId),
        eq(alertEvents.metric, POINTS_FRAUD_METRIC),
        eq(alertEvents.subjectKind, 'user'),
        eq(alertEvents.subjectRef, input.userId),
        sql`${alertEvents.evidence}->>'bucket' = ${hour}`,
        sql`${alertEvents.evidence}->>'kind' = ${flag.kind}`,
      ))
      .limit(1);
    if (already.length > 0) continue;

    await db.insert(alertEvents).values({
      tenantId: input.tenantId,
      metric: POINTS_FRAUD_METRIC,
      message: flag.summary,
      status: 'triggered',
      subjectKind: 'user',
      subjectRef: input.userId,
      severity: flag.severity,
      evidence: { ...flag.evidence, kind: flag.kind, bucket: hour },
    });
  }

  if (input.flags.some((flag) => flag.severity === 'high') && !input.profile.suspended) {
    await writePointsProfile(db, input.tenantId, input.userId, {
      ...input.profile,
      suspended: true,
      suspendedReason: input.flags.find((flag) => flag.severity === 'high')?.kind ?? 'fraud',
    });
    await invalidatePointsCaches(env, input.tenantId, input.userId);
  }
}
