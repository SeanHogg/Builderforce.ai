/**
 * Cloud-agent RUN accounting — the consumption-framework "platform compute" meter,
 * mirroring application/web/outboundFetchLedger.ts.
 *
 * A cloud run executes on OUR infra even when the tenant brings their own model
 * (BYO tokens are $0 to us, but the orchestration/compute isn't), so this meters
 * cloud usage independently of token volume. On-prem / VSIX runs execute on the
 * user's own machine and never consume it.
 *
 * There is no separate "record" step: every cloud LLM turn already writes a usage
 * row stamped `surface = 'cloud'` with its `execution_id` (usageLedger /
 * recordCloudUsage). One RUN = one distinct `execution_id`, so we count distinct
 * executions on cloud-surface rows. `dailyTenantCloudRuns` is THE single accountant
 * (shared by the consumption meter and the dispatch gate) so the number a member
 * SEES equals the number ENFORCED.
 */

import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { llmUsageLog, tenants } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { resolveCloudRunsMonthly } from '../../domain/tenant/PlanLimits';
import { TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { utcMonthStart } from '../llm/tokenUsage';
import { tenantHasSuperadminMember } from '../llm/tenantTokenAvailability';

/** Only cloud-surface usage rows that carry an execution id count as a run. */
const cloudRunRow = and(eq(llmUsageLog.surface, 'cloud'), isNotNull(llmUsageLog.executionId));

/**
 * Per-day distinct cloud-run count since `since` (UTC day buckets, sparse). Day
 * totals sum to {@link sumTenantCloudRuns}; drives the consumption-meter sparkline.
 */
export async function dailyTenantCloudRuns(
  db: Db,
  tenantId: number,
  since: Date,
): Promise<Array<{ day: string; value: number }>> {
  const dayExpr = sql<string>`to_char(${llmUsageLog.createdAt}, 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day: dayExpr, used: sql<number>`COUNT(DISTINCT ${llmUsageLog.executionId})` })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, since), cloudRunRow))
    .groupBy(dayExpr)
    .orderBy(dayExpr);
  return rows.map((r) => ({ day: r.day, value: Math.max(0, Math.floor(Number(r.used ?? 0))) }));
}

/**
 * Cloud runs by a tenant since `since` — the single window total the meter and the
 * gate share. Defined as the SUM of per-day distinct counts (so it can't drift from
 * the sparkline the meter renders); a run that spans UTC midnight counts once per
 * day it touches, which is conservative for a cap and negligible in practice.
 */
export async function sumTenantCloudRuns(db: Db, tenantId: number, since: Date): Promise<number> {
  const daily = await dailyTenantCloudRuns(db, tenantId, since);
  return daily.reduce((total, r) => total + r.value, 0);
}

export type CloudRunCapResult =
  | { allowed: true }
  | { allowed: false; effectivePlan: TenantPlan; used: number; limit: number };

/**
 * Gate a NEW cloud-agent run against the tenant's monthly allowance. Self-contained
 * (resolves plan + limit + month-to-date count from the tenantId). Unlimited plans
 * always pass; so does a tenant OWNED/operated by a superadmin — that "superadmin ⇒
 * unlimited" rule is NOT re-implemented here: it reuses the SAME primitive the token
 * gate uses ({@link tenantHasSuperadminMember}), so the operator's bypass is defined
 * in exactly one place and covers both the token cap and this cloud-run cap. The
 * superadmin lookup runs ONLY for an already-capped tenant, so unlimited tenants pay
 * nothing; pass `env` to serve it through the read-through cache. Fails OPEN on a
 * query error — a metering hiccup must not block a legitimate run.
 */
export async function enforceCloudRunCap(db: Db, tenantId: number, env?: Env): Promise<CloudRunCapResult> {
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
    const limit = resolveCloudRunsMonthly({
      effectivePlan,
      tokenDailyLimitOverride: tenantRow?.tokenDailyLimitOverride ?? null,
    });
    if (limit < 0) return { allowed: true }; // plan-unlimited (Teams / -1 override)

    // A superadmin OPERATOR is unlimited everywhere — same bypass, same source of
    // truth as the token gate. Only consulted once the plan already caps the tenant.
    if (await tenantHasSuperadminMember(db, tenantId, env)) return { allowed: true };

    const used = await sumTenantCloudRuns(db, tenantId, utcMonthStart());
    if (used >= limit) return { allowed: false, effectivePlan, used, limit };
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
