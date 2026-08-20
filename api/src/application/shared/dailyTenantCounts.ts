/**
 * The day-bucketed tenant row count every consumption ledger was re-deriving.
 *
 * Five meters (error events, outbound fetches, cloud runs, stage-sandbox runs and
 * feedback submissions) all answer the same question of a different table: "how
 * many rows did this tenant write per UTC day since `since`, and what is the
 * window total?". Each ledger had its own copy of the `to_char(…, 'YYYY-MM-DD')`
 * grouped scan, which is the failure this module prevents: the bucket expression,
 * the `Math.max(0, Math.floor(…))` coercion and the tenant predicate are the
 * CONTRACT the consumption framework densifies against ({@link densifyDaily}
 * expects `YYYY-MM-DD` keys and non-negative integers), and six hand-written
 * copies of a contract drift one at a time — a meter whose day keys are shaped
 * differently silently renders a flat sparkline while its total keeps climbing.
 *
 * Each ledger still owns what is genuinely its own: which table, which timestamp
 * column, which rows even count (a `capped` sandbox run does not), and whether
 * the unit is a row or a distinct id. Those arrive as arguments; the shape of the
 * answer does not.
 */

import { and, eq, gte, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../../infrastructure/database/connection';

export interface DailyTenantCountSpec {
  /** The table holding one row per metered occurrence. */
  table: PgTable;
  /** That table's tenant column — the scope predicate, never inferred by join. */
  tenantColumn: PgColumn;
  /** The timestamp the day buckets are cut on. */
  createdAtColumn: PgColumn;
  /** Extra predicate for rows that do not count (e.g. a refused dispatch). */
  where?: SQL;
  /** Override for a non-row unit, e.g. `COUNT(DISTINCT execution_id)`. */
  countExpr?: SQL<number>;
}

/** One `{ day, value }` bucket per UTC day the tenant actually wrote rows on. */
export interface DailyCount {
  day: string;
  value: number;
}

/**
 * Per-day count for one tenant since `since` (UTC day buckets, SPARSE — quiet days
 * are absent, and the consumption framework zero-fills them).
 *
 * Sparse on purpose: a dense series is a presentation concern that only the meter
 * needs, and materialising it in SQL would make every gate pay for a sparkline
 * nobody is looking at.
 */
export async function dailyTenantCounts(
  db: Db,
  tenantId: number,
  since: Date,
  spec: DailyTenantCountSpec,
): Promise<DailyCount[]> {
  const dayExpr = sql<string>`to_char(${spec.createdAtColumn}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day: dayExpr, used: spec.countExpr ?? sql<number>`COUNT(*)` })
    .from(spec.table)
    .where(and(eq(spec.tenantColumn, tenantId), gte(spec.createdAtColumn, since), spec.where))
    .groupBy(dayExpr)
    .orderBy(dayExpr);
  return rows.map((r) => ({ day: r.day, value: Math.max(0, Math.floor(Number(r.used ?? 0))) }));
}

/**
 * Window total for one tenant since `since`, as a SINGLE ungrouped scan.
 *
 * The gate runs on the request path and only ever wants one number, so it does not
 * pay for the day buckets the sparkline needs. Uses the identical table, predicate
 * and coercion as {@link dailyTenantCounts} — same `spec`, one definition — which
 * is what keeps the total a gate ENFORCES equal to the series a meter RENDERS.
 */
export async function sumTenantRowCount(
  db: Db,
  tenantId: number,
  since: Date,
  spec: DailyTenantCountSpec,
): Promise<number> {
  const [row] = await db
    .select({ used: spec.countExpr ?? sql<number>`COUNT(*)` })
    .from(spec.table)
    .where(and(eq(spec.tenantColumn, tenantId), gte(spec.createdAtColumn, since), spec.where));
  return Math.max(0, Math.floor(Number(row?.used ?? 0)));
}

/**
 * Window total as the SUM of already-fetched day buckets.
 *
 * For a meter whose unit is not a row — cloud runs count DISTINCT execution ids —
 * an ungrouped total and a per-day total are genuinely different numbers (a run
 * spanning UTC midnight counts once per day it touches). Those meters define the
 * total as the day sum so the number cannot drift from the sparkline beside it,
 * and pay for one grouped scan instead of two queries.
 */
export function sumDailyCounts(daily: DailyCount[]): number {
  return daily.reduce((total, r) => total + r.value, 0);
}
