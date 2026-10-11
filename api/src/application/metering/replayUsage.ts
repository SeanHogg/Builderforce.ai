/**
 * Replay usage accounting — the session-replay half of the consumption framework.
 *
 * `recordReplayVisit` records a new replay visit (recording); `sumTenantReplayRecordings`
 * is the single accountant for "recordings in a window" (shared by the meter and the gate);
 * `enforceReplayCap` is the request-path gate that prevents NEW recordings once a tenant
 * is over its monthly allowance.
 *
 * Counts `replay_visits` in the UTC month. Fail-open: a ledger error never
 * blocks a legitimate recording.
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';
import { and, eq, gte, sql } from 'drizzle-orm';
import { replayVisits } from '../../infrastructure/database/schema/growth';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { enforceMonthlyTenantCap, type MonthlyTenantCapResult } from '../shared/monthlyTenantCap';
import { utcMonthStart } from '../llm/tokenUsage';

/**
 * Default replay recordings limit per month for free tier.
 * This limit is applied when enforceReplayCap is called.
 */
const DEFAULT_REPLAY_RECORDINGS_LIMIT = 50;

export interface RecordReplayVisitRow {
  tenantId: number;
  /** Opaque recorder key (`replay_visits.site_id` is varchar, not `project_sites.id`). */
  siteId: string;
  visitId: string;
  recordedAt: Date;
  storageBytes?: number;
}

/**
 * Record a new replay visit. Best-effort — never throws (metering must not fail
 * the recording it's measuring).
 */
export async function recordReplayVisit(
  db: Db,
  row: RecordReplayVisitRow,
): Promise<void> {
  try {
    await db.insert(replayVisits).values({
      visitId: row.visitId,
      siteId: row.siteId,
      tenantId: row.tenantId,
      startedAt: row.recordedAt,
      lastEventAt: row.recordedAt,
      durationMs: 0,
      activeMs: 0,
    });
  } catch (error) {
    // Never let replay usage logging fail the recording
    reportCaughtError(error, {
      source: "application/metering/replayUsage.ts",
      operation: "recordReplayVisit"
    });
  }
}

/**
 * Total replay recordings by a tenant since `since` — the single window-sum the meter
 * and the gate share.
 */
export async function sumTenantReplayRecordings(
  db: Db,
  tenantId: number,
  since: Date,
): Promise<number> {
  try {
    const [row] = await db
      .select({ used: sql<number>`count(*)` })
      .from(replayVisits)
      .where(and(
        eq(replayVisits.tenantId, tenantId),
        gte(replayVisits.startedAt, since)
      ));
    return Math.max(0, Number(row?.used ?? 0));
  } catch (error) {
    reportCaughtError(error, {
      source: "application/metering/replayUsage.ts",
      operation: "sumTenantReplayRecordings"
    });
    return 0;
  }
}

/**
 * Per-day replay recordings since `since` (UTC day buckets, sparse). Day totals sum
 * to {@link sumTenantReplayRecordings}; drives the consumption-meter sparkline.
 */
export async function dailyTenantReplayRecordings(
  db: Db,
  tenantId: number,
  since: Date,
): Promise<Array<{ day: string; value: number }>> {
  try {
    const dayExpr = sql<string>`to_char(${replayVisits.startedAt}, 'YYYY-MM-DD')`;
    const rows = await db
      .select({ day: dayExpr, used: sql<number>`count(*)` })
      .from(replayVisits)
      .where(and(
        eq(replayVisits.tenantId, tenantId),
        gte(replayVisits.startedAt, since)
      ))
      .groupBy(dayExpr)
      .orderBy(dayExpr);
    return rows.map((r) => ({ day: r.day, value: Math.max(0, Number(r.used ?? 0)) }));
  } catch (error) {
    reportCaughtError(error, {
      source: "application/metering/replayUsage.ts",
      operation: "dailyTenantReplayRecordings"
    });
    return [];
  }
}

/**
 * Total storage used by replay recordings for a tenant since `since`.
 * 
 * Note: The replay_visits table doesn't track storage bytes directly.
 * Storage tracking would need to be added to the schema or tracked elsewhere.
 * For now, returns 0.
 */
export async function sumTenantReplayStorageBytes(
  _db: Db,
  _tenantId: number,
  _since: Date,
): Promise<number> {
  // Storage tracking not implemented in replay_visits schema
  // Would need storage_bytes column added to track this
  return 0;
}

export type ReplayCapResult = MonthlyTenantCapResult;

/**
 * Gate NEW recordings against the tenant's monthly recording allowance. Self-contained:
 * resolves the tenant's effective plan + limit and sums month-to-date usage, so a
 * caller only needs the tenantId. Unlimited plans (and superadmin-unlimited
 * tenants) always pass. Fails OPEN on a query error — a metering hiccup must not
 * block a legitimate recording.
 */
export async function enforceReplayCap(
  db: Db,
  tenantId: number,
  env?: Env,
): Promise<ReplayCapResult> {
  return enforceMonthlyTenantCap({
    db,
    tenantId,
    env,
    resolveLimit: ({ tokenDailyLimitOverride }) =>
      tokenDailyLimitOverride === -1 ? -1 : DEFAULT_REPLAY_RECORDINGS_LIMIT,
    sumUsage: sumTenantReplayRecordings,
  });
}

/**
 * Pre-recording check. Mirrors {@link MonthlyTenantCapResult}: the allowed
 * (or unlimited / fail-open) path has no numeric `limit`; the denied path
 * carries `used` as `currentUsage` plus `limit`/`remaining`.
 */
export type ReplayAllowanceResult =
  | { allowed: true; currentUsage: number; limit: null; remaining: null }
  | { allowed: false; currentUsage: number; limit: number; remaining: number };

export async function checkReplayAllowance(
  db: Db,
  tenantId: number,
  env?: Env,
): Promise<ReplayAllowanceResult> {
  const monthStart = utcMonthStart();
  const currentUsage = await sumTenantReplayRecordings(db, tenantId, monthStart);
  const capResult = await enforceReplayCap(db, tenantId, env);

  if (!capResult.allowed) {
    return {
      allowed: false,
      currentUsage: capResult.used,
      limit: capResult.limit,
      remaining: Math.max(0, capResult.limit - capResult.used),
    };
  }

  return {
    allowed: true,
    currentUsage,
    limit: null,
    remaining: null,
  };
}
