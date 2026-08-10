import {
  PLAN_FEATURE_LABEL,
  evaluateFeatureEntitlement,
  type PlanFeature,
} from '../../domain/tenant/planFeatures';
import type { TenantPlan } from '../../domain/shared/types';

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
