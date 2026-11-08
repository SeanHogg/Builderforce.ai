import type { Env } from '../../env';
import { TenantPlan } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import { effectivePlanOf, loadTenantPlanRow } from '../tenant/tenantPlanSnapshot';
import { resolveSuperadminUnlimited } from '../llm/tenantTokenAvailability';
import { utcMonthStart } from '../llm/tokenUsage';

export type MonthlyTenantCapResult =
  | { allowed: true }
  | { allowed: false; effectivePlan: TenantPlan; used: number; limit: number };

type ResolveMonthlyLimit = (input: {
  effectivePlan: TenantPlan;
  tokenDailyLimitOverride: number | null;
}) => number;

export interface ResolveTenantCapLimitOptions {
  db: Db;
  tenantId: number;
  env?: Env;
  /** The person acting, so the superadmin bypass is evaluated for them as well as for the tenant's members. */
  actingUserId?: string | null;
  resolveLimit: ResolveMonthlyLimit;
}

/** A tenant's cap, or `unlimited` (a negative plan limit, or a superadmin). */
export type TenantCapLimit =
  | { unlimited: true }
  | { unlimited: false; effectivePlan: TenantPlan; limit: number };

/**
 * THE cap-limit resolution every tenant cap shares: the plan lookup, the plan's limit,
 * and the superadmin-unlimited bypass. A throw propagates; callers decide the posture
 * (every enforcer here fails open).
 */
export async function resolveTenantCapLimit({
  db, tenantId, env, actingUserId, resolveLimit,
}: ResolveTenantCapLimitOptions): Promise<TenantCapLimit> {
  const tenantRow = await loadTenantPlanRow(env, tenantId, db);
  const effectivePlan = effectivePlanOf(tenantRow);
  const limit = resolveLimit({
    effectivePlan,
    tokenDailyLimitOverride: tenantRow?.tokenDailyLimitOverride ?? null,
  });
  if (limit < 0) return { unlimited: true };
  if (await resolveSuperadminUnlimited(db, tenantId, { actingUserId }, env)) {
    return { unlimited: true };
  }
  return { unlimited: false, effectivePlan, limit };
}

export interface EnforceTenantCapOptions {
  db: Db;
  tenantId: number;
  env?: Env;
  /** Use a separate handle when metering data lives outside the primary database. */
  usageDb?: Db;
  /** The person acting (see {@link ResolveTenantCapLimitOptions.actingUserId}). */
  actingUserId?: string | null;
  resolveLimit: ResolveMonthlyLimit;
  sumUsage: (db: Db, tenantId: number, since: Date) => Promise<number>;
}

/**
 * Shared tenant-cap policy for non-token consumption meters (monthly volume meters and
 * the concurrent-run cap alike - the unit differs, the policy does not).
 *
 * Limit resolution, the superadmin bypass, month boundaries, and fail-open
 * behavior belong here so every meter enforces the same policy. Each meter still
 * owns its unit-specific allowance and aggregation query through the callbacks.
 */
export async function enforceTenantCap({
  db,
  tenantId,
  env,
  usageDb = db,
  actingUserId,
  resolveLimit,
  sumUsage,
}: EnforceTenantCapOptions): Promise<MonthlyTenantCapResult> {
  try {
    const cap = await resolveTenantCapLimit({ db, tenantId, env, actingUserId, resolveLimit });
    if (cap.unlimited) return { allowed: true };

    const used = await sumUsage(usageDb, tenantId, utcMonthStart());
    return used >= cap.limit
      ? { allowed: false, effectivePlan: cap.effectivePlan, used, limit: cap.limit }
      : { allowed: true };
  } catch {
    // Metering must never block the operation it measures when accounting fails.
    return { allowed: true };
  }
}
