/**
 * Estimated time savings for recommendations.
 * Provides primitives for % reduction, minutes/hours, and recurring pattern.
 * Distinct and update types for RecommendationWithEstimates.
 */
export type EstimationPattern = 'ONE_TIME' | 'RECURRING' | 'ON_DEMAND';
export type EstimationUnit = 'MINUTES' | 'HOURS' | 'DAYS';

/**
 * Represents a point-estimate metric:
 * - value: numerical value (e.g. minutes, hours, days, or percent)
 * - unit: 'MINUTES', 'HOURS', 'DAYS', or '%' for percent reduction
 */
export interface EstimationMetric {
  value: number;
  unit: EstimationUnit | '%';
  applicableWindow: 'PER_RUN' | 'PER_TASK' | 'PER_WEEK' | 'PER_MONTH' | 'PER_YEAR';
  notes?: string; // e.g. formula explanation (kept UI via tooltips; PRD: "static explanation")
}

/**
 * Represents an estimated time saving for a recommendation.
 * Primarily used via RecommendationWithEstimates.
 */
export interface Estimation {
  /**
   * Whether the estimation is applicable (true if value > 0).
   */
  applicable: boolean;

  /**
   * Primary metric of estimated time saving.
   */
  primary: EstimationMetric;

  /**
   * Alternative representation (e.g. hours for a large number of minutes) — optional.
   */
  secondary?: EstimationMetric;

  /**
   * Estimation pattern: ONE_TIME, RECURRING, or ON_DEMAND.
   */
  pattern: EstimationPattern;

  /**
   * Notes for the calculation/cause (kept static via layout; UI via tooltips).
   */
  notes?: string;
}

/**
 * Utility to mark estimate as applicable: only if primary value > 0 or there is a positive secondary.
 */
export function isEstimationApplicable(est: Estimation): boolean {
  if (!est) return false;
  if (est.applicable) return true;
  const hasValue = (est.primary?.value ?? 0) > 0;
  const hasSecondary = est.secondary != null && (est.secondary.value ?? 0) > 0;
  return hasValue || hasSecondary || !!!est.applicable;
}

/**
 * Content summary (for UI summaries).
 */
export interface EstimationSummary {
  text: string;
  altText?: string;
}