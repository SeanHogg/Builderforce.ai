/**
 * Configuration for workforce gap analysis (offline).
 * Proficiency weighting: partial contribution of a lower-ranked skill match.
 * Flat ramp model for hire time-to-fill (common seniority bands).
 */

/**
 * Proficiency levels: 1..5 inclusive.
 */
export type ProficiencyLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Proficiency multiplier: how much of a requirement is met by a lower-ranked match.
 * - Level 3 vs Level 5: 0.6060606 (k = 1.5)
 * - Level 3 vs Level 4: 0.750000 (k = 2.0)
 * - Level 3 vs Level 3: 1.000000 (k = INF)
 */
export const PROFICIENCY_WEIGHTS: Record<ProficiencyLevel, Record<ProficiencyLevel, number>> = {
  1: { 1: 1.0, 2: 2.0, 3: 3.0, 4: 4.0, 5: 5.0 }, // maximum penalty per level
  2: { 1: 0.5, 2: 1.0, 3: 1.5, 4: 2.0, 5: 2.5 }, // maximum penalty per level
  3: { 1: 0.333333, 2: 0.666666, 3: 1.0, 4: 1.5, 5: 2.0 },
  4: { 1: 0.25, 2: 0.5, 3: 0.666666, 4: 1.0, 5: 1.5 },
  5: { 1: 0.2, 2: 0.4, 3: 0.5, 4: 0.666666, 5: 1.0 },
};

/**
 * Estimated months-to-fill for external hires.
 * Default flat ramp as a future placeholder.
 * In practice this can be replaced by hiring measure vs urgency-priority buckets.
 */
export const HIRE_TTM_MONTHS: Record<string, number> = {
  // placeholder enum; updates can be role-specific in future
  default: 3,
};

/**
 * Hiring urgency tiers based on gap severity and due quarter.
 * - Critical (>50%) or impact >3 quarters out: P1
 * - Moderate (25–50%): P2
 * - Low (<25%): P3
 */
export const URGENCY_TIERS = {
  P1: { minSeverity: 0.5, minQuartersOut: 3 },
  P2: { minSeverity: 0.25, maxSeverity: 0.5 },
  P3: { minSeverity: 0.0, maxSeverity: 0.25 },
} as const;

/**
 * Cross-project compounding threshold: at least this many concurrent projects must share a skill
 * to surface as a compounding gap.
 */
export const COMPOUNDING_THRESHOLD_PROCESSES = 3;

/**
 * Minimum seniority delta between requirement and match to consider a redeploy as near-match.
 */
export const REDEPLOY_NEAR_MATCH_DELTA = 1;

/**
 * Secondary gap risk threshold: source team coverage must fall to or below this % to flag.
 */
export const SECONDARY_GAP_COVERAGE_THRESHOLD = 0.75;