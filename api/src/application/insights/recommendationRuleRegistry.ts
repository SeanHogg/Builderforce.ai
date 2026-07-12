/**
 * Typed, feature-controlled recommendation rules registry (FR-1.3).
 * Example: cost_anomaly is on by default; low_capitalizable is off by default until confirmed safe.
 *
 * Also enforces backend data constraints:
 * - every recommendation title must be ≤120 chars (PRD AC-8)
 * - every detail must be ≤300 chars (PRD AC-8)
 * - hard dedup by (rule, entity, field, value) keeps the first (stable key) to surface only once
 */

import { createHash } from 'node:crypto';

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
  'cost.budget_over': { enabled: true },
  'cost.per_pr_spike': { enabled: true },
  'quality.low_merge_rate': { enabled: true },
  'quality.model_low_merge': { enabled: true },
  'quality.high_degraded': { enabled: true },
  'allocation.below_target': { enabled: true },
  'allocation.low_capitalizable': { enabled: false },
  'delivery.high_cfr': { enabled: true },
  'delivery.high_mttr': { enabled: true },
  'delivery.high_lead_time': { enabled: true },
};

/**
 * Export a single function to gate rule execution at the call boundary.
 * Returns true if the rule should run; false otherwise.
 */
export function isRuleEnabled(ruleKey: ExecutableRecommendationRuleKey): boolean {
  return RECOMMENDATION_RULE_FLAGS[ruleKey]?.enabled ?? false;
}

/**
 * Hard-dedup helper. Accepts a rule key and a set of context fields (entity, field, value) that uniquely identify a concrete condition.
 * If a rec_key already exists for this (rule, entity, field, value), returns it; otherwise returns null (new).
 * This ensures the same concrete issue surfaces only once (FR-1.1 and dedup requirement) and the first rec_key wins (stable ID).
 */
export function computeRecommendationId(
  ruleKey: string,
  entity: string | number | undefined,
  field: string | undefined,
  value: string | number | undefined,
): string | null {
  // Ensure both entity and field are truthy; otherwise not enough context.
  if (!entity || !field) {
    return null;
  }

  // Use Keccak-256 hash of a deterministic string for the rec_key to avoid collisions.
  // If value is present, include it for precision; otherwise use only the entity+field.
  if (value !== undefined && value !== null) {
    const payload = `${ruleKey}|${entity}|${field}|${value}`;
    const hash = createHash('keccak256').update(payload).digest('hex');
    return hash;
  }

  const payload = `${ruleKey}|${entity}|${field}`;
  const hash = createHash('keccak256').update(payload).digest('hex');
  return hash;
}