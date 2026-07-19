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
  advancedInsights: 'advanced insights (forecasting & exec lenses)',
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

// ---------------------------------------------------------------------------
// Frontier / premium-model access — a SEPARATE axis from the boolean PlanFeature
// flags above. "Can this tenant use a FRONTIER model?" (teach/distil from a top
// model, pick a premium model, run an agent on Opus/GPT/Gemini) is unlocked by an
// EXTRA dimension the plan-feature gate has no concept of: a CONNECTED BYO frontier
// account. When the tenant brings their own key/subscription, THEIR tokens fund the
// frontier call, so the paid-plan wall is irrelevant — and a superadmin never hits a
// wall. One evaluator so every frontier gate (teach/distil, premium model pick,
// "run on a top model") answers this identically.
// ---------------------------------------------------------------------------

export type FrontierAccessReason = 'superadmin' | 'premium_override' | 'byo_connected' | 'paid_plan' | 'not_entitled';

export interface FrontierAccessInput {
  /** The tenant's effective (trial/billing-resolved) plan. */
  effectivePlan: TenantPlan;
  /** Comped / beta premium override on the tenant. */
  premiumOverride: boolean;
  /** The CALLER is a platform superadmin — always bypasses the gate. */
  isSuperadmin: boolean;
  /**
   * The tenant has connected ≥1 BYO frontier account/key — an Anthropic subscription
   * (OAuth) OR a BYO api-key for anthropic/openai/google. Their OWN tokens fund the
   * frontier call, so the paid-plan wall does not apply.
   */
  hasConnectedByoFrontier: boolean;
}

export interface FrontierAccess {
  entitled: boolean;
  reason: FrontierAccessReason;
}

/**
 * THE frontier-access evaluator. Pure. Unlocked (in priority order) by: superadmin →
 * premium override → a connected BYO frontier account (own tokens) → a paid plan.
 * Otherwise not entitled (free plan with no connected account).
 */
export function evaluateFrontierAccess(input: FrontierAccessInput): FrontierAccess {
  if (input.isSuperadmin) return { entitled: true, reason: 'superadmin' };
  if (input.premiumOverride) return { entitled: true, reason: 'premium_override' };
  if (input.hasConnectedByoFrontier) return { entitled: true, reason: 'byo_connected' };
  if (input.effectivePlan !== TenantPlan.FREE) return { entitled: true, reason: 'paid_plan' };
  return { entitled: false, reason: 'not_entitled' };
}

// ---------------------------------------------------------------------------
// Premium-MODEL access — a THIRD axis, distinct from both the boolean PlanFeature
// flags AND frontier access. "May this tenant SELECT any paid OpenRouter model
// (billed at OpenRouter cost + a flat 1¢/request)?" is unlocked by a stricter
// rule than frontier access: it needs a PAID plan AND a VALIDATED card on file —
// a card we ran an explicit validation (SetupIntent / $0 auth) against — so the
// per-request metered spend has a funding instrument behind it. A superadmin or a
// comped premium override bypasses (operators/betas never hit the wall). BYO does
// NOT unlock premium selection: BYO routes on the tenant's OWN key (frontier
// access covers that); premium routes on OUR metered OpenRouter key, so it needs a
// validated card regardless of any connected provider. One evaluator so the picker,
// the gateway gate, and the /v1/models flag can never drift.
// ---------------------------------------------------------------------------

export type PremiumModelReason =
  | 'superadmin'
  | 'premium_override'
  | 'paid_card'
  | 'card_required'   // paid plan, but no validated card yet — the actionable miss
  | 'plan_required';  // free plan — needs to upgrade first

export interface PremiumModelAccessInput {
  /** The tenant's effective (trial/billing-resolved) plan. */
  effectivePlan: TenantPlan;
  /** Comped / beta premium override on the tenant. */
  premiumOverride: boolean;
  /** The CALLER is a platform superadmin — always bypasses the gate. */
  isSuperadmin: boolean;
  /** A card has been through the explicit validation flow (card_validated_at set). */
  cardValidated: boolean;
}

export interface PremiumModelAccess {
  entitled: boolean;
  reason: PremiumModelReason;
  /** What the tenant must do to unlock, when not entitled: upgrade or validate a card. */
  unlock?: 'upgrade' | 'validate_card';
}

/**
 * THE premium-model-access evaluator. Pure. Unlocked (in priority order) by:
 * superadmin → premium override → (paid plan AND a validated card). A paid plan
 * with no validated card reports `card_required` (unlock: validate_card); a free
 * plan reports `plan_required` (unlock: upgrade).
 */
export function evaluatePremiumModelAccess(input: PremiumModelAccessInput): PremiumModelAccess {
  if (input.isSuperadmin) return { entitled: true, reason: 'superadmin' };
  if (input.premiumOverride) return { entitled: true, reason: 'premium_override' };
  if (input.effectivePlan === TenantPlan.FREE) return { entitled: false, reason: 'plan_required', unlock: 'upgrade' };
  if (!input.cardValidated) return { entitled: false, reason: 'card_required', unlock: 'validate_card' };
  return { entitled: true, reason: 'paid_card' };
}

/**
 * The standardized premium-model **402** body. Names WHICH of the two walls the caller
 * hit (upgrade vs validate a card) so the client routes to the right action instead of
 * showing a generic paywall.
 *
 * Lives here (pure domain) rather than in the route middleware because BOTH the gateway
 * (`llmRoutes`, which owns `resolveTenantPlan` and so cannot import the middleware back
 * without a cycle) and `featureGate.requirePremiumModelAccess` must answer with the
 * identical envelope.
 */
export function premiumModelGateBody(access: PremiumModelAccess) {
  const needsCard = access.unlock === 'validate_card';
  return {
    error: needsCard
      ? 'Premium models (any paid OpenRouter model, billed at OpenRouter cost + 1¢ per request) require a validated card on file. Add and validate a card in Settings ▸ Billing to unlock.'
      : 'Premium models (any paid OpenRouter model) require a paid plan (Pro/Teams) with a validated card on file.',
    code: 'premium_model_not_allowed' as const,
    feature: 'premiumModels' as const,
    reason: access.reason,
    unlock: access.unlock,
    requiredPlan: TenantPlan.PRO,
    upgrade: !needsCard,
  };
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
