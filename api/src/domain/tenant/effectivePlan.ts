import { TenantPlan, TenantBillingStatus } from '../shared/types';

/**
 * The single source of truth for "what plan limits does this tenant actually
 * get right now". Every entitlement gate (AgentHost cap, project cap, token/day,
 * Pro features) MUST funnel through this — never re-derive "is this tenant paid"
 * inline, or the trial / paid / expired rules drift apart.
 *
 * Effective-plan rules:
 *   - billingStatus === 'active'   → the tenant's paid `plan` (pro/teams), else free.
 *   - billingStatus === 'trialing' AND trialEndsAt in the future → the trial `plan`
 *     (a freshly-created tenant gets a 14-day Pro trial — see Tenant.create()).
 *   - trial expired (trialEndsAt <= now) or any other status → free.
 *
 * Pure + dependency-free so the domain entity, the plan-limits guard, and the LLM
 * gateway resolver all share ONE implementation.
 */
export interface EffectivePlanInput {
  /** The tenant's nominal plan (free/pro/teams). */
  plan: TenantPlan;
  billingStatus: TenantBillingStatus;
  /** When an active trial ends; null when the tenant is not (and never was) trialing. */
  trialEndsAt: Date | null;
}

/** True when the tenant is inside an unexpired Pro/Teams trial window. */
export function isTrialActive(
  billingStatus: TenantBillingStatus,
  trialEndsAt: Date | null,
  now: Date = new Date(),
): boolean {
  return (
    billingStatus === TenantBillingStatus.TRIALING &&
    trialEndsAt != null &&
    trialEndsAt.getTime() > now.getTime()
  );
}

/**
 * Resolve the plan whose limits the tenant is currently entitled to.
 * `now` is injectable for deterministic tests.
 */
export function resolveEffectivePlan(input: EffectivePlanInput, now: Date = new Date()): TenantPlan {
  // Paid, active subscription → the purchased plan.
  if (input.billingStatus === TenantBillingStatus.ACTIVE) {
    if (input.plan === TenantPlan.TEAMS) return TenantPlan.TEAMS;
    if (input.plan === TenantPlan.PRO) return TenantPlan.PRO;
    return TenantPlan.FREE;
  }
  // Unexpired trial → the trial plan (Pro/Teams as stored on `plan`).
  if (isTrialActive(input.billingStatus, input.trialEndsAt, now)) {
    if (input.plan === TenantPlan.TEAMS) return TenantPlan.TEAMS;
    if (input.plan === TenantPlan.PRO) return TenantPlan.PRO;
    return TenantPlan.FREE;
  }
  // Expired trial, past-due, cancelled, none, pending → free.
  return TenantPlan.FREE;
}

/** Days remaining in an active trial (rounded up), or null when not trialing. */
export function trialDaysRemaining(
  billingStatus: TenantBillingStatus,
  trialEndsAt: Date | null,
  now: Date = new Date(),
): number | null {
  if (!isTrialActive(billingStatus, trialEndsAt, now)) return null;
  const ms = trialEndsAt!.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/** Length of the introductory Pro trial granted on tenant creation. */
export const TRIAL_DURATION_DAYS = 14;
