import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { TenantBillingStatus, TenantPlan } from '../../domain/shared/types';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import type { Db } from '../../infrastructure/database/connection';
import { tenants } from '../../infrastructure/database/schema';
import { resolveSuperadminUnlimited } from '../llm/tenantTokenAvailability';
import { utcMonthStart } from '../llm/tokenUsage';

export type MonthlyTenantCapResult =
  | { allowed: true }
  | { allowed: false; effectivePlan: TenantPlan; used: number; limit: number };

type ResolveMonthlyLimit = (input: {
  effectivePlan: TenantPlan;
  tokenDailyLimitOverride: number | null;
}) => number;

export interface EnforceMonthlyTenantCapOptions {
  db: Db;
  tenantId: number;
  env?: Env;
  /** Use a separate handle when metering data lives outside the primary database. */
  usageDb?: Db;
  resolveLimit: ResolveMonthlyLimit;
  sumUsage: (db: Db, tenantId: number, since: Date) => Promise<number>;
}

/**
 * Shared monthly-cap policy for non-token consumption meters.
 *
 * Limit resolution, the superadmin bypass, month boundaries, and fail-open
 * behavior belong here so every meter enforces the same policy. Each meter still
 * owns its unit-specific allowance and aggregation query through the callbacks.
 */
export async function enforceMonthlyTenantCap({
  db,
  tenantId,
  env,
  usageDb = db,
  resolveLimit,
  sumUsage,
}: EnforceMonthlyTenantCapOptions): Promise<MonthlyTenantCapResult> {
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
    const limit = resolveLimit({
      effectivePlan,
      tokenDailyLimitOverride: tenantRow?.tokenDailyLimitOverride ?? null,
    });
    if (limit < 0) return { allowed: true };

    if (await resolveSuperadminUnlimited(db, tenantId, undefined, env)) {
      return { allowed: true };
    }

    const used = await sumUsage(usageDb, tenantId, utcMonthStart());
    return used >= limit
      ? { allowed: false, effectivePlan, used, limit }
      : { allowed: true };
  } catch {
    // Metering must never block the operation it measures when accounting fails.
    return { allowed: true };
  }
}
