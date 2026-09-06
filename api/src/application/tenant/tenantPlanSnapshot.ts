/**
 * Tenant plan snapshot — the ONE cached read of a tenant's plan, billing,
 * superadmin-override and card-validation columns, and the one place those
 * columns become an effective plan.
 *
 * Before this module the same `SELECT plan, billingStatus, trialEndsAt … FROM
 * tenants WHERE id = ?` was written out ten times (the gateway's resolver, the
 * rate limiter, the plan-limits guard, the token-availability check, the monthly
 * cap, the team-spend overview, the architect runner, two dashboards) and every
 * one of them hit the database on every request. A tenant's plan changes a
 * handful of times in its life; it was being re-read thousands of times an hour.
 *
 * Served through the canonical read-through cache (L1 in-isolate + KV) and
 * invalidated by every writer of these columns — see `tenantPlanCache`. The raw
 * row is what is cached; the effective plan is recomputed on each read because
 * it depends on the clock (a trial expires without a write).
 */

import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { tenants } from '../../infrastructure/database/schema';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { TenantBillingStatus, TenantPlan } from '../../domain/shared/types';
import { resolveEffectivePlan, type EffectivePlan } from '../../domain/tenant/effectivePlan';
import { isCardValidated, type CardValidationStatus } from './cardValidationService';
import { tenantPlanCacheKey } from './tenantPlanCache';

/** The cached row. Dates are ISO strings because the row round-trips through KV as JSON. */
export interface TenantPlanRow {
  id: number;
  plan: string | null;
  billingStatus: string | null;
  trialEndsAt: string | null;
  tokenDailyLimitOverride: number | null;
  paidOverflowDailyCap: number | null;
  premiumDailyCap: number | null;
  imageCreditsDailyLimit: number | null;
  premiumOverride: boolean | null;
  cardValidatedAt: string | null;
  cardValidationStatus: string | null;
  memberDefaultSpendCapMillicents: number | null;
}

export interface TenantPlanSnapshot {
  plan: 'free' | 'pro' | 'teams';
  billingStatus: 'none' | 'pending' | 'active' | 'trialing' | 'past_due' | 'cancelled';
  effectivePlan: EffectivePlan;
  /**
   * Superadmin override for the plan-level daily token cap.
   *   null → use plan default
   *   -1   → unlimited (skip the gate)
   *   >= 0 → use this value
   */
  tokenDailyLimitOverride: number | null;
  /**
   * Per-tenant daily ceiling on paid-overflow spend (millicents), or null to use
   * the plan default. -1 = unlimited (gate skipped). See migration 0130 and
   * DEFAULT_PAID_OVERFLOW_CAP_MILLICENTS.
   */
  paidOverflowDailyCap: number | null;
  /** Per-tenant daily ceiling on PREMIUM spend, millicents (0952). null → plan
   *  default; -1 → unlimited. See `isPremiumSpendExhausted`. */
  premiumDailyCap: number | null;
  /**
   * Per-tenant daily image-generation credit override (1 credit = 1 returned
   * image), or null to use the plan default. -1 = unlimited. Metered separately
   * from the text token budget (migration 0131). See resolveImageCreditsDailyLimit.
   */
  imageCreditsDailyLimit: number | null;
  /** Superadmin grant of premium routing — when true the LLM proxy uses the
   *  premium model pool (top PREMIUM-tier models) and the extended per-vendor
   *  timeout regardless of plan/billingStatus. Comped / beta access. */
  premiumOverride: boolean;
  /**
   * The tenant has a card that passed the explicit validation flow (SetupIntent /
   * zero-amount auth — migration 0342). Combined with a PAID plan this unlocks
   * PREMIUM model selection: any paid OpenRouter model, billed at OpenRouter cost
   * plus a flat per-request surcharge. See `evaluatePremiumModelAccess`.
   */
  cardValidated: boolean;
  /** Where the card-validation flow currently stands (drives the unlock CTA). */
  cardValidationStatus: CardValidationStatus;
}

/** Safety net only — every writer invalidates explicitly (see `tenantPlanCache`). */
const KV_TTL_SECONDS = 60 * 60;

const toIso = (value: Date | string | null | undefined): string | null =>
  value == null ? null : value instanceof Date ? value.toISOString() : value;

/**
 * The tenant's plan row, cached. `null` when the tenant does not exist. Pass `db`
 * when the caller already holds a handle (a cold miss reuses it); pass `env` so
 * the read is served through KV — without it the read is a plain query.
 */
export async function loadTenantPlanRow(env: Env | undefined, tenantId: number, db?: Db): Promise<TenantPlanRow | null> {
  return getOrSetCached(env, tenantPlanCacheKey(tenantId), async () => {
    const handle = db ?? (env ? buildDatabase(env) : null);
    if (!handle) throw new Error('loadTenantPlanRow needs a worker env or a database handle');
    const [row] = await handle
      .select({
        id: tenants.id,
        plan: tenants.plan,
        billingStatus: tenants.billingStatus,
        trialEndsAt: tenants.trialEndsAt,
        tokenDailyLimitOverride: tenants.tokenDailyLimitOverride,
        paidOverflowDailyCap: tenants.paidOverflowDailyCap,
        premiumDailyCap: tenants.premiumDailyCap,
        imageCreditsDailyLimit: tenants.imageCreditsDailyLimit,
        premiumOverride: tenants.premiumOverride,
        cardValidatedAt: tenants.cardValidatedAt,
        cardValidationStatus: tenants.cardValidationStatus,
        memberDefaultSpendCapMillicents: tenants.memberDefaultSpendCapMillicents,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!row) return null;
    return {
      ...row,
      trialEndsAt: toIso(row.trialEndsAt),
      cardValidatedAt: toIso(row.cardValidatedAt),
    };
  }, { kvTtlSeconds: KV_TTL_SECONDS });
}

/**
 * The single shared resolver applied to a (possibly missing) row: 'active'
 * (paid) OR an unexpired trial → the tenant's plan; everything else → free.
 * A missing tenant is free. Never re-derive this inline.
 */
export function effectivePlanOf(row: Pick<TenantPlanRow, 'plan' | 'billingStatus' | 'trialEndsAt'> | null, now = new Date()): TenantPlan {
  if (!row) return TenantPlan.FREE;
  return resolveEffectivePlan(
    {
      plan: (row.plan as TenantPlan) ?? TenantPlan.FREE,
      billingStatus: (row.billingStatus as TenantBillingStatus) ?? TenantBillingStatus.NONE,
      trialEndsAt: row.trialEndsAt ? new Date(row.trialEndsAt) : null,
    },
    now,
  );
}

/** Pure projection of a cached row onto the snapshot the gateway and gates consume. */
export function toTenantPlanSnapshot(row: TenantPlanRow, now = new Date()): TenantPlanSnapshot {
  const cardValidationStatus = (row.cardValidationStatus ?? 'none') as CardValidationStatus;
  return {
    plan: (row.plan ?? 'free') as TenantPlanSnapshot['plan'],
    billingStatus: (row.billingStatus ?? 'none') as TenantPlanSnapshot['billingStatus'],
    effectivePlan: effectivePlanOf(row, now) as EffectivePlan,
    tokenDailyLimitOverride: row.tokenDailyLimitOverride ?? null,
    paidOverflowDailyCap: row.paidOverflowDailyCap ?? null,
    premiumDailyCap: row.premiumDailyCap ?? null,
    imageCreditsDailyLimit: row.imageCreditsDailyLimit ?? null,
    premiumOverride: row.premiumOverride === true,
    // A card counts as validated only when the flow COMPLETED (status + stamp) —
    // the same rule `isCardValidated` applies, kept in lockstep via one predicate.
    cardValidated: isCardValidated(
      { status: cardValidationStatus, validatedAt: row.cardValidatedAt ? new Date(row.cardValidatedAt) : null },
      now.getTime(),
    ),
    cardValidationStatus,
  };
}

/**
 * Resolve a tenant id to its plan/billing snapshot and derive the effective plan
 * (downgrades to 'free' when billing isn't active). Shared by every API-key-style
 * auth path on the gateway, the feature gate, and every application use case
 * that prices work by plan. Throws when the tenant does not exist.
 */
export async function resolveTenantPlan(env: Env | undefined, tenantId: number, db?: Db): Promise<TenantPlanSnapshot> {
  const row = await loadTenantPlanRow(env, tenantId, db);
  if (!row) throw new Error('Tenant not found');
  return toTenantPlanSnapshot(row);
}

/** The effective plan alone (FREE for a missing tenant) — for gates that need nothing else. */
export async function resolveTenantEffectivePlan(env: Env | undefined, tenantId: number, db?: Db): Promise<TenantPlan> {
  return effectivePlanOf(await loadTenantPlanRow(env, tenantId, db));
}
