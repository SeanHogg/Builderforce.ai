/**
 * Error-event accounting — the Quality pillar's half of the consumption framework,
 * mirroring application/ingestion/ingestionLedger.ts exactly.
 *
 * `sumTenantErrorEvents` is THE single accountant for "error events ingested in a
 * window" (shared by the consumption meter and the ingest gate); `enforceErrorEventsCap`
 * is the request-path gate that pauses NEW error ingestion once a tenant is over its
 * monthly allowance — graceful backpressure: already-stored groups/events stay fully
 * usable, only fresh ingestion stops. Count is the metered quantity (one event row =
 * one unit), since error events are uniform and high-cardinality.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import { errorEvents, tenants } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { resolveErrorEventsMonthly } from '../../domain/tenant/PlanLimits';
import { TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { utcMonthStart } from '../llm/tokenUsage';

/** Error events ingested by a tenant since `since` — the single window-sum the
 *  meter and the gate share. */
export async function sumTenantErrorEvents(db: Db, tenantId: number, since: Date): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`COUNT(*)` })
    .from(errorEvents)
    .where(and(eq(errorEvents.tenantId, tenantId), gte(errorEvents.createdAt, since)));
  return Math.max(0, Math.floor(Number(row?.used ?? 0)));
}

/** Per-day error-event count since `since` (UTC day buckets, sparse). Day totals
 *  sum to {@link sumTenantErrorEvents}; drives the consumption-meter sparkline. */
export async function dailyTenantErrorEvents(
  db: Db,
  tenantId: number,
  since: Date,
): Promise<Array<{ day: string; value: number }>> {
  const dayExpr = sql<string>`to_char(${errorEvents.createdAt}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day: dayExpr, used: sql<number>`COUNT(*)` })
    .from(errorEvents)
    .where(and(eq(errorEvents.tenantId, tenantId), gte(errorEvents.createdAt, since)))
    .groupBy(dayExpr)
    .orderBy(dayExpr);
  return rows.map((r) => ({ day: r.day, value: Math.max(0, Math.floor(Number(r.used ?? 0))) }));
}

export type ErrorEventsCapResult =
  | { allowed: true }
  | { allowed: false; effectivePlan: TenantPlan; used: number; limit: number };

/**
 * Gate NEW error ingestion against the tenant's monthly event allowance.
 * Self-contained (resolves plan + limit + month-to-date count from the tenantId).
 * Unlimited plans (and superadmin-unlimited tenants) always pass. Fails OPEN on a
 * query error — a metering hiccup must not drop a legitimate error report.
 */
export async function enforceErrorEventsCap(db: Db, tenantId: number): Promise<ErrorEventsCapResult> {
  try {
    const [tenantRow] = await db
      .select({
        plan: tenants.plan,
        billingStatus: tenants.billingStatus,
        trialEndsAt: tenants.trialEndsAt,
        tokenDailyLimitOverride: tenants.tokenDailyLimitOverride,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const effectivePlan = resolveEffectivePlan({
      plan: (tenantRow?.plan ?? 'free') as TenantPlan,
      billingStatus: (tenantRow?.billingStatus ?? 'none') as TenantBillingStatus,
      trialEndsAt: tenantRow?.trialEndsAt ?? null,
    });
    const limit = resolveErrorEventsMonthly({
      effectivePlan,
      tokenDailyLimitOverride: tenantRow?.tokenDailyLimitOverride ?? null,
    });
    if (limit < 0) return { allowed: true }; // unlimited

    const used = await sumTenantErrorEvents(db, tenantId, utcMonthStart());
    if (used >= limit) return { allowed: false, effectivePlan, used, limit };
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
