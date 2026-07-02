/**
 * tenantTokenAvailability — context-free answer to "does this tenant have token
 * budget left right now, and if not, why". THE single check the autonomous
 * execution cron gates cloud runs on (a tenant that is out of tokens must not
 * keep burning our pool), reusing the EXACT same limit resolver
 * ({@link resolveTokenLimits}) + usage accountant ({@link sumTenantTextTokensDayAndMonth})
 * the request-path gate (`enforceTokenCaps` in llmRoutes) and the consumption
 * meter use — so "out of tokens" here means the same thing the user sees on the
 * meter and the same thing the gateway enforces.
 *
 * Unlike `enforceTokenCaps`, this takes no Hono `Context`: it resolves the
 * tenant's plan snapshot straight from the `tenants` row so a cron (which has
 * only `db`) can call it per tenant.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tenants } from '../../infrastructure/database/schema';
import { TenantPlan, TenantBillingStatus } from '../../domain/shared/types';
import { resolveEffectivePlan } from '../../domain/tenant/effectivePlan';
import { resolveTokenLimits } from '../../domain/tenant/PlanLimits';
import { sumTenantTextTokensDayAndMonth, utcDayStart, utcMonthStart } from './tokenUsage';

export type TokenExhaustionReason = 'daily_exhausted' | 'monthly_exhausted';

export interface TenantTokenAvailability {
  /** True when the tenant may spend on our pool (neither daily nor monthly cap hit). */
  hasTokens: boolean;
  /** Why the tenant is blocked, or null when it has budget. */
  reason: TokenExhaustionReason | null;
  /** Resolved daily cap (-1 = unlimited). */
  dailyLimit: number;
  /** Resolved monthly cap (-1 = unlimited). */
  monthlyLimit: number;
  /** Cache-discounted text tokens used so far today / this month. */
  usageToday: number;
  usageMonth: number;
  /** The plan the tenant is currently entitled to (drives the upgrade copy). */
  effectivePlan: 'free' | 'pro' | 'teams';
}

/** Map a TenantPlan enum back to the string form used in user-facing copy. */
function planString(plan: TenantPlan): 'free' | 'pro' | 'teams' {
  if (plan === TenantPlan.TEAMS) return 'teams';
  if (plan === TenantPlan.PRO) return 'pro';
  return 'free';
}

/**
 * Resolve a tenant's live token availability. Unlimited tenants (superadmin
 * override -1, or a plan with no cap) short-circuit to `hasTokens: true` without a
 * usage scan. Otherwise a single day+month scan decides it. Best-effort by
 * contract: the caller (cron) treats a throw as "unknown" and skips rather than
 * blocks — see the sweep.
 */
export async function getTenantTokenAvailability(db: Db, tenantId: number): Promise<TenantTokenAvailability> {
  const [row] = await db
    .select({
      plan: tenants.plan,
      billingStatus: tenants.billingStatus,
      trialEndsAt: tenants.trialEndsAt,
      tokenDailyLimitOverride: tenants.tokenDailyLimitOverride,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const plan = (row?.plan ?? 'free') as keyof typeof TenantPlan | string;
  const billingStatus = (row?.billingStatus ?? 'none') as string;
  const effectivePlanEnum = resolveEffectivePlan({
    plan: (plan as TenantPlan) ?? TenantPlan.FREE,
    billingStatus: billingStatus as TenantBillingStatus,
    trialEndsAt: row?.trialEndsAt ?? null,
  });
  const effectivePlan = planString(effectivePlanEnum);

  const { dailyLimit, monthlyLimit } = resolveTokenLimits({
    effectivePlan: effectivePlanEnum,
    tokenDailyLimitOverride: row?.tokenDailyLimitOverride ?? null,
  });

  const dailyCapped = dailyLimit > 0;
  const monthlyCapped = monthlyLimit > 0;

  // No positive cap on either axis → unlimited; skip the usage scan entirely.
  if (!dailyCapped && !monthlyCapped) {
    return { hasTokens: true, reason: null, dailyLimit, monthlyLimit, usageToday: 0, usageMonth: 0, effectivePlan };
  }

  const usage = await sumTenantTextTokensDayAndMonth(db, tenantId, utcDayStart(), utcMonthStart());

  const dailyExhausted = dailyCapped && usage.day >= dailyLimit;
  const monthlyExhausted = monthlyCapped && usage.month >= monthlyLimit;
  const reason: TokenExhaustionReason | null = dailyExhausted ? 'daily_exhausted' : monthlyExhausted ? 'monthly_exhausted' : null;

  return {
    hasTokens: reason === null,
    reason,
    dailyLimit,
    monthlyLimit,
    usageToday: usage.day,
    usageMonth: usage.month,
    effectivePlan,
  };
}

/** The 429 body an interactive run path returns when the tenant is out of tokens.
 *  Codes mirror the LLM gateway's `enforceTokenCaps` so a client that already
 *  handles the gateway's 429 handles these identically. */
export interface TokenGateBlock {
  error: string;
  code: 'plan_token_limit_exceeded' | 'plan_monthly_token_limit_exceeded';
  reason: TokenExhaustionReason;
  effectivePlan: 'free' | 'pro' | 'teams';
}

/** Plan-tailored upgrade hint appended to a cap-exceeded message (mirrors the
 *  gateway's copy so the daily/monthly caps read the same everywhere). */
function tokenGateUpgradeHint(effectivePlan: 'free' | 'pro' | 'teams', window: 'daily' | 'monthly'): string {
  if (effectivePlan === 'free') {
    return window === 'monthly'
      ? ' Upgrade to Pro at builderforce.ai/pricing for a higher monthly allowance.'
      : ' Upgrade to Pro at builderforce.ai/pricing.';
  }
  if (effectivePlan === 'pro') {
    return window === 'monthly'
      ? ' Upgrade to Teams for an unlimited monthly allowance.'
      : ' Upgrade to Teams for a 5× higher daily budget.';
  }
  return '';
}

/**
 * THE single token gate for the interactive run paths (Run-now, submit execution):
 * returns a 429 block when the tenant is out of budget, or null to proceed. Shared
 * so "no budget → no run" is defined once for every manual dispatch surface (and
 * matches the autonomous cron's gate + the gateway's spend gate). Fails OPEN on any
 * error — a transient usage-scan failure must not block a human clicking Run.
 */
export async function checkTenantTokenGate(db: Db, tenantId: number): Promise<TokenGateBlock | null> {
  let availability: TenantTokenAvailability;
  try {
    availability = await getTenantTokenAvailability(db, tenantId);
  } catch {
    return null; // fail open
  }
  if (availability.hasTokens || !availability.reason) return null;

  const window = availability.reason === 'monthly_exhausted' ? 'monthly' : 'daily';
  const cap = window === 'monthly' ? availability.monthlyLimit : availability.dailyLimit;
  const base = window === 'monthly'
    ? `Plan monthly token allowance reached (${cap.toLocaleString()} tokens).`
    : `Plan daily token limit reached (${cap.toLocaleString()} tokens).`;
  return {
    error: `${base}${tokenGateUpgradeHint(availability.effectivePlan, window)}`,
    code: window === 'monthly' ? 'plan_monthly_token_limit_exceeded' : 'plan_token_limit_exceeded',
    reason: availability.reason,
    effectivePlan: availability.effectivePlan,
  };
}
