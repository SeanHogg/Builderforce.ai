import {
  PLAN_FEATURE_LABEL,
  evaluateFeatureEntitlement,
  type FeatureEntitlement,
  type PlanFeature,
} from '../../domain/tenant/planFeatures';
import { TenantPlan } from '../../domain/shared/types';
import type { Env } from '../../env';
import { resolveIsSuperadmin } from '../../infrastructure/auth/superadminFlag';
import { resolveTenantPlan } from './tenantPlanSnapshot';

/**
 * Every plan feature resolved at once, for a caller who needs the whole set
 * rather than one answer.
 *
 * The gates ({@link requireFeature}, {@link tenantHasFeature}) ask about ONE
 * feature at a time, which is right for a route. A CLIENT rendering navigation
 * needs the whole set — it has to know which destinations to show locked before
 * the user clicks anything — and the only alternative to shipping it is a
 * client-side plan→feature map, i.e. a second evaluator that drifts the first
 * time a flag moves between plans.
 *
 * So this fans the ONE pure evaluator over the feature list, which is itself
 * derived from {@link PLAN_FEATURE_LABEL} rather than restated: add a flag to
 * PlanLimits and it appears here with no edit.
 */

export interface FeatureEntitlementSet {
  /** Feature → entitled. */
  entitled: Record<PlanFeature, boolean>;
  /** Feature → the lowest plan that unlocks it, for the upsell copy on a miss. */
  requiredPlan: Record<PlanFeature, TenantPlan>;
}

export const PLAN_FEATURES = Object.keys(PLAN_FEATURE_LABEL) as PlanFeature[];

export function resolveAllFeatureEntitlements(input: {
  effectivePlan: TenantPlan;
  premiumOverride: boolean;
  isSuperadmin: boolean;
}): FeatureEntitlementSet {
  const entitled = {} as Record<PlanFeature, boolean>;
  const requiredPlan = {} as Record<PlanFeature, TenantPlan>;
  for (const feature of PLAN_FEATURES) {
    const verdict = evaluateFeatureEntitlement({ ...input, feature });
    entitled[feature] = verdict.entitled;
    requiredPlan[feature] = verdict.requiredPlan;
  }
  return { entitled, requiredPlan };
}

/** Map the gateway's string effectivePlan to the plan enum. */
export function toTenantPlan(ep: 'free' | 'pro' | 'teams'): TenantPlan {
  if (ep === 'pro') return TenantPlan.PRO;
  if (ep === 'teams') return TenantPlan.TEAMS;
  return TenantPlan.FREE;
}

/**
 * Resolve a caller's entitlement to `feature` — plan + superadmin + comped override,
 * composed over the ONE cached plan read. `userId` optional: when absent the superadmin
 * dimension is skipped (machine callers can't be superadmins).
 *
 * This lives in the APPLICATION layer, not behind the route gate, because decisions other
 * than "reject this request" need it: cloud dispatch picks a run's surface from
 * `containerRuntime`, and a route handler is not in scope there. `requireFeature` in
 * `presentation/middleware/featureGate` is the 402-answering wrapper over this.
 */
export async function resolveFeatureEntitlement(
  env: Env,
  tenantId: number,
  userId: string | undefined | null,
  feature: PlanFeature,
): Promise<FeatureEntitlement> {
  const [access, isSuperadmin] = await Promise.all([
    resolveTenantPlan(env, tenantId),
    resolveIsSuperadmin(env, userId),
  ]);
  return evaluateFeatureEntitlement({
    feature,
    effectivePlan: toTenantPlan(access.effectivePlan),
    premiumOverride: access.premiumOverride,
    isSuperadmin,
  });
}

/**
 * Boolean convenience for decision sites that ATTACH or SHAPE a paid feature rather than
 * error on it (store a psychometric profile only if entitled; run on the container surface
 * only if entitled). Superadmin- and premium-override-aware, same as the erroring gate.
 */
export async function tenantHasFeature(
  env: Env,
  tenantId: number,
  userId: string | undefined | null,
  feature: PlanFeature,
): Promise<boolean> {
  return (await resolveFeatureEntitlement(env, tenantId, userId, feature)).entitled;
}
