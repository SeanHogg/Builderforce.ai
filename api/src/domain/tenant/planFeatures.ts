import { TenantPlan } from '../shared/types';
import { PlanLimits, PLAN_LIMITS, getLimits } from './PlanLimits';

/**
 * Plan-feature entitlement — the single, pure evaluator every paid-plan gate uses.
 *
 * A "feature" is one of the BOOLEAN flags on {@link PlanLimits} (approvalWorkflows,
 * psychometricPersona, …). This module answers exactly one question — "is this
 * caller entitled to `feature`?" — and it always answers it the same way, in this
 * order:
 *
 *   1. superadmin        → yes (platform operators never hit a plan wall)
 *   2. premiumOverride   → yes (comped / beta grant on the tenant)
 *   3. plan grants it    → yes
 *   4. otherwise         → no, and it reports WHICH plan unlocks it
 *
 * Pure + dependency-light (PlanLimits + the enum only) so the route gate, the
 * attach-decision helpers, and unit tests share ONE implementation and can never
 * drift. The DB-touching / context-aware wrapper lives in
 * `presentation/middleware/featureGate.ts`.
 */

/** The subset of {@link PlanLimits} keys that are boolean feature flags. */
export type PlanFeature = {
  [K in keyof PlanLimits]: PlanLimits[K] extends boolean ? K : never;
}[keyof PlanLimits];

/**
 * Human-facing label per feature — the ONE place the gate copy lives. Phrased as a
 * plain noun phrase so `featureGateBody` can slot it into "Upgrade to Pro to unlock
 * <label>." without pluralization gymnastics.
 */
export const PLAN_FEATURE_LABEL: Record<PlanFeature, string> = {
  approvalWorkflows: 'approval workflows',
  fleetMesh: 'fleet mesh',
  fullTelemetry: 'full telemetry & audit trail',
  customAgentRoles: 'custom agent roles',
  psychometricPersona: 'psychometric personas',
  teamApprovalInbox: 'the team approval inbox',
  seatCostControls: 'per-seat cost controls',
  voiceCloning: 'voice cloning',
};

/** Plans in ascending order of entitlement. */
const PLAN_ORDER: readonly TenantPlan[] = [TenantPlan.FREE, TenantPlan.PRO, TenantPlan.TEAMS];

/**
 * The lowest plan whose limits include `feature`. Derived from PLAN_LIMITS so the
 * "required plan" a gate advertises can never drift from what the plan actually
 * grants — add the flag to PRO and this returns PRO automatically.
 */
export function requiredPlanForFeature(feature: PlanFeature): TenantPlan {
  for (const plan of PLAN_ORDER) {
    if (PLAN_LIMITS[plan][feature]) return plan;
  }
  // Not granted on any plan → treat as the top tier (defensive; shouldn't happen).
  return TenantPlan.TEAMS;
}

export interface FeatureEntitlementInput {
  feature: PlanFeature;
  /** The tenant's effective (trial/billing-resolved) plan. */
  effectivePlan: TenantPlan;
  /** Comped / beta premium override on the tenant. */
  premiumOverride: boolean;
  /** The CALLER is a platform superadmin — always bypasses the gate. */
  isSuperadmin: boolean;
}

export type EntitlementReason = 'superadmin' | 'premium_override' | 'plan' | 'not_entitled';

export interface FeatureEntitlement {
  entitled: boolean;
  /** Why the verdict landed the way it did (drives telemetry + copy). */
  reason: EntitlementReason;
  feature: PlanFeature;
  label: string;
  currentPlan: TenantPlan;
  /** The lowest plan that unlocks `feature` — what to advertise on a miss. */
  requiredPlan: TenantPlan;
}

/** THE evaluator. Pure — same inputs always yield the same verdict. */
export function evaluateFeatureEntitlement(input: FeatureEntitlementInput): FeatureEntitlement {
  const base = {
    feature: input.feature,
    label: PLAN_FEATURE_LABEL[input.feature],
    currentPlan: input.effectivePlan,
    requiredPlan: requiredPlanForFeature(input.feature),
  };
  if (input.isSuperadmin) return { ...base, entitled: true, reason: 'superadmin' };
  if (input.premiumOverride) return { ...base, entitled: true, reason: 'premium_override' };
  if (getLimits(input.effectivePlan)[input.feature]) return { ...base, entitled: true, reason: 'plan' };
  return { ...base, entitled: false, reason: 'not_entitled' };
}
