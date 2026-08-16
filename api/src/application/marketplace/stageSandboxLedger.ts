/**
 * Stage-sandbox RUN accounting — the consumption-framework meter for a
 * disposable-container execution dispatched from a Stage press, mirroring
 * application/runtime/cloudRunLedger.ts.
 *
 * Count-based, like every other meter in this framework: one row in
 * `stage_sandbox_runs` that actually consumed container time (`queued`,
 * `running`, `passed`, `failed` or `error` — everything except `capped`, which
 * never reached the container) is one unit. No duration/instance-hour billing
 * exists anywhere in this codebase yet, and inventing one here for a single
 * meter would be a new billing dimension nobody asked for.
 */

import { and, eq, gte, ne, sql } from 'drizzle-orm';
import { stageSandboxRuns } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveStageSandboxRunsMonthly } from '../../domain/tenant/PlanLimits';
import { enforceMonthlyTenantCap, type MonthlyTenantCapResult } from '../shared/monthlyTenantCap';

/** `capped` rows never reached a container and cost nothing — excluded so a
 *  tenant already at their cap cannot be charged again for being refused. */
const dispatchedRow = ne(stageSandboxRuns.status, 'capped');

/** Per-day dispatched-run count since `since` (UTC day buckets, sparse). Day
 *  totals sum to {@link sumTenantStageSandboxRuns}; drives the meter sparkline. */
export async function dailyTenantStageSandboxRuns(
  db: Db,
  tenantId: number,
  since: Date,
): Promise<Array<{ day: string; value: number }>> {
  const dayExpr = sql<string>`to_char(${stageSandboxRuns.createdAt}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day: dayExpr, used: sql<number>`COUNT(*)` })
    .from(stageSandboxRuns)
    .where(and(eq(stageSandboxRuns.tenantId, tenantId), gte(stageSandboxRuns.createdAt, since), dispatchedRow))
    .groupBy(dayExpr)
    .orderBy(dayExpr);
  return rows.map((r) => ({ day: r.day, value: Math.max(0, Math.floor(Number(r.used ?? 0))) }));
}

/** Dispatched sandbox runs by a tenant since `since` — the single window total
 *  the meter and the gate share. */
export async function sumTenantStageSandboxRuns(db: Db, tenantId: number, since: Date): Promise<number> {
  const daily = await dailyTenantStageSandboxRuns(db, tenantId, since);
  return daily.reduce((total, r) => total + r.value, 0);
}

export type StageSandboxCapResult = MonthlyTenantCapResult;

/**
 * Gate a NEW sandbox dispatch against the tenant's monthly allowance.
 * Self-contained; fails OPEN on a query error, exactly like every other cap in
 * this framework — a metering hiccup must not block a legitimate Stage press.
 */
export async function enforceStageSandboxCap(db: Db, tenantId: number, env?: Env): Promise<StageSandboxCapResult> {
  return enforceMonthlyTenantCap({
    db,
    tenantId,
    env,
    resolveLimit: resolveStageSandboxRunsMonthly,
    sumUsage: sumTenantStageSandboxRuns,
  });
}
