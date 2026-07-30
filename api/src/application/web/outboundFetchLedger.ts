/**
 * Outbound-fetch accounting — the consumption-framework half of the Brain's
 * `/fetch-url` proxy, mirroring application/quality/errorEventsLedger.ts exactly.
 *
 * `sumTenantOutboundFetches` is THE single accountant for "outbound fetches in a
 * window" (shared by the consumption meter and the cap gate); `enforceOutboundFetchCap`
 * is the request-path gate that refuses NEW fetches once a tenant is over its monthly
 * allowance — graceful backpressure (the per-tenant rate limit caps burst, this caps
 * sustained volume). Count is the metered quantity (one fetch = one unit); the outbound
 * cost is the request, not the response, so we meter fetches that hit the wire.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import { outboundFetchLog, tenants } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { resolveSuperadminUnlimited } from '../llm/tenantTokenAvailability';
import { resolveOutboundFetchesMonthly } from '../../domain/tenant/PlanLimits';
import { TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { utcMonthStart } from '../llm/tokenUsage';

/** Record one outbound fetch (best-effort; caller waitUntils it off the hot path). */
export async function recordOutboundFetch(db: Db, tenantId: number, url: string | null): Promise<void> {
  await db.insert(outboundFetchLog).values({ tenantId, url: url ? url.slice(0, 2048) : null });
}

/** Outbound fetches by a tenant since `since` — the single window-sum the meter
 *  and the gate share. */
export async function sumTenantOutboundFetches(db: Db, tenantId: number, since: Date): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`COUNT(*)` })
    .from(outboundFetchLog)
    .where(and(eq(outboundFetchLog.tenantId, tenantId), gte(outboundFetchLog.createdAt, since)));
  return Math.max(0, Math.floor(Number(row?.used ?? 0)));
}

/** Per-day outbound-fetch count since `since` (UTC day buckets, sparse). Day totals
 *  sum to {@link sumTenantOutboundFetches}; drives the consumption-meter sparkline. */
export async function dailyTenantOutboundFetches(
  db: Db,
  tenantId: number,
  since: Date,
): Promise<Array<{ day: string; value: number }>> {
  const dayExpr = sql<string>`to_char(${outboundFetchLog.createdAt}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day: dayExpr, used: sql<number>`COUNT(*)` })
    .from(outboundFetchLog)
    .where(and(eq(outboundFetchLog.tenantId, tenantId), gte(outboundFetchLog.createdAt, since)))
    .groupBy(dayExpr)
    .orderBy(dayExpr);
  return rows.map((r) => ({ day: r.day, value: Math.max(0, Math.floor(Number(r.used ?? 0))) }));
}

export type OutboundFetchCapResult =
  | { allowed: true }
  | { allowed: false; effectivePlan: TenantPlan; used: number; limit: number };

/**
 * Gate NEW outbound fetches against the tenant's monthly allowance. Self-contained
 * (resolves plan + limit + month-to-date count from the tenantId). Unlimited plans
 * (and superadmin-unlimited tenants) always pass. Fails OPEN on a query error — a
 * metering hiccup must not block a legitimate fetch.
 */
export async function enforceOutboundFetchCap(db: Db, tenantId: number, env?: Env): Promise<OutboundFetchCapResult> {
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
    const limit = resolveOutboundFetchesMonthly({
      effectivePlan,
      tokenDailyLimitOverride: tenantRow?.tokenDailyLimitOverride ?? null,
    });
    if (limit < 0) return { allowed: true }; // plan-unlimited (Teams / -1 override)

    // A superadmin OPERATOR is unlimited on EVERY meter — same rule, same source of
    // truth as the token and cloud-run gates. Only consulted once the plan already
    // caps the tenant, so unlimited tenants pay nothing for it.
    if (await resolveSuperadminUnlimited(db, tenantId, undefined, env)) return { allowed: true };

    const used = await sumTenantOutboundFetches(db, tenantId, utcMonthStart());
    if (used >= limit) return { allowed: false, effectivePlan, used, limit };
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
