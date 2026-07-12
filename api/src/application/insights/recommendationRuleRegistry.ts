/**
 * Typed, feature-controlled recommendation rules registry (FR-1.3).
 * Example: cost_anomaly is on by default; low_capitalizable is off by default until confirmed safe.
 */

// Use the string types from recommendationsEngine.ts for consistency.
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
 * Type-safe flag map with defaults: enabled if true, optional default.
 * This surface lets the engineering team toggle rules at runtime without a deploy.
 */
export const RECOMMENDATION_RULE_FLAGS: Record<ExecutableRecommendationRuleKey, { enabled: boolean; default?: boolean }> = {
  cost.budget_over: { enabled: true },
  cost.per_pr_spike: { enabled: true },
  quality.low_merge_rate: { enabled: true },
  quality.model_low_merge: { enabled: true },
  quality.high_degraded: { enabled: true },
  allocation.below_target: { enabled: true },
  allocation.low_capitalizable: { enabled: false },
  delivery.high_cfr: { enabled: true },
  delivery.high_mttr: { enabled: true },
  delivery.high_lead_time: { enabled: true },
};

/**
 * Export a single function to gate rule execution at the call boundary.
 * Returns true if the rule should run; false otherwise.
 */
export function isRuleEnabled(ruleKey: ExecutableRecommendationRuleKey): boolean {
  return RECOMMENDATION_RULE_FLAGS[ruleKey]?.enabled ?? false;
}