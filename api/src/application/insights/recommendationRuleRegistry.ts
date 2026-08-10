export type ExecutableRecommendationRuleKey =
  | 'cost.budget_over'
  | 'cost.per_pr_spike'
  | 'quality.low_merge_rate'
  | 'quality.model_low_merge'
  | 'quality.high_degraded'
  | 'allocation.below_target'
  | 'allocation.low_capitalizable'
  | 'delivery.high_cfr'
  | 'delivery.high_mttr'
  | 'delivery.high_lead_time';

/**
 * Central registry for recommendation rules. Rules remain enabled by default so
 * adding the registry cannot silently remove recommendations that existed before
 * this feature. A later settings surface can supply tenant-specific overrides.
 */
export const RECOMMENDATION_RULE_FLAGS: Readonly<Record<ExecutableRecommendationRuleKey, boolean>> = {
  'cost.budget_over': true,
  'cost.per_pr_spike': true,
  'quality.low_merge_rate': true,
  'quality.model_low_merge': true,
  'quality.high_degraded': true,
  'allocation.below_target': true,
  'allocation.low_capitalizable': true,
  'delivery.high_cfr': true,
  'delivery.high_mttr': true,
  'delivery.high_lead_time': true,
};

export function isRuleEnabled(ruleKey: ExecutableRecommendationRuleKey): boolean {
  return RECOMMENDATION_RULE_FLAGS[ruleKey];
}
