/**
 * Schedule Health computation library — the single server-side source for all
 * Schedule Health metrics requested by FR-1..FR-5 in PRD #296
 *
 * Definitions (all integer or plain-number, no fractions unless specified):
 *   - daysAtRiskRaw = projectedEndDate - committedDeadline (in days, may be negative)
 *   - velocity (story points per sprint, integer)
 *   - days in forecast horizon (integer)
 *   - overdueTaskCount (integer)
 *   - totalTaskCountInPeriod (integer)
 *   - predictabilityPct = completedPoints / committedPoints (%, integer)
 *
 * Roles:
 *   - deadlineRiskTier(per PRD: 0 for On Track ≤0 days, 1 for At Risk 1–7 days, 2 for Off Track >7 days)
 *   - velocityDirection(per PRD: 1 improving, 0 stable, -1 declining)
 *   - velocityAnomaly(not implemented here; would be later, per PRD FR-2.5)
 */

/**
 * Deadline risk tier per PRD description:
 *   On Track: ≤0 days at risk
 *   At Risk: 1–7 days
 *   Off Track: >7 days
 */
export function deadlineRiskTier(daysAtRisk: number): 0 | 1 | 2 {
  if (daysAtRisk <= 0) return 0;
  if (daysAtRisk <= 7) return 1;
  return 2;
}

/**
 * Days At Risk delta per PRD (negative = buffer, positive = slippage). Null if no valid dates.
 */
export function daysAtRisk(
  committedDeadline: Date | null,
  projectedEndDate: Date | null,
): number | null {
  if (!committedDeadline || !projectedEndDate) return null;
  const diffMs = projectedEndDate.getTime() - committedDeadline.getTime();
  // Using calendar days (midnight) to match PRD FS
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  return diffDays;
}

/**
 * Velocity trend direction per PRD: 1 improving, 0 stable (±10%), -1 declining.
 * Assumptions: avgVelocity vs prevVelocity are given as story points per sprint.
 */
export function velocityDirection(avgVelocity: number, prevVelocity: number): 1 | 0 | -1 {
  const pctChange = avgVelocity !== 0 && prevVelocity !== 0
    ? ((avgVelocity - prevVelocity) / prevVelocity)
    : avgVelocity > prevVelocity ? 1 : avgVelocity < prevVelocity ? -1 : 0;
  // ±10% meaningful tolerance: allow small negative diffs at or above -10%
  if (pctChange >= -0.1) return 1; // improving
  if (pctChange <= 0.1) return 0; // stable
  return -1; // declining
}

/**
 * Absolute difference from target as a percent (0–100). No float tolerance yet.
 */
export function targetVariancePercent(
  targetVariance: number, // can be negative or positive
): number {
  return Math.round(Math.abs(targetVariance) * 100);
}

/**
 * Merge into a unified health score (0–100) as per FR-5.1.
 *
 * FR-5 weights (adjustable per project/role):
 *   - deadlineRisk (default 40)
 *   - velocityTrend (default 30)
 *   - sprintPredictability (default 20)
 *   - overdueRate (default 10)
 *
 * Score = sum of w_i * (s_i: 0..100)
 *
 * Mapping:
 *   - deadlineRisk: tier 0 → 100, tier 1 → 60, tier 2 → 0
 *   - velocityTrend: improving → 100, stable → 80, declining → 50
 *   - sprintPredictability: predictPct (0..100)
 *   - overdueRate: ratePercent (0..100)
 *
 * If any component medical is null/not-applicable, we fall back to pruned GS.
 */
export interface HealthScoreWeights {
  deadlineRisk: number;
  velocityTrend: number;
  sprintPredictability: number;
  overdueRate: number;
}

 /** Default weights as per PRD. */
export const DEFAULT_HEALTH_SCORE_WEIGHTS: HealthScoreWeights = {
  deadlineRisk: 40,
  velocityTrend: 30,
  sprintPredictability: 20,
  overdueRate: 10,
};

/**
 * Map raw metric to a primary score contribution (0–100).
 */
export function metricContributionScore(value: number | null | undefined): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Final computed date-windowed health score (0–100) with integer-precision scores.
 *
 * Returns the merged integer healthScore and its array of component values for UX/summary.
 */
export interface ScheduleHealthResult {
  /** Overall health score (0–100, integer). */
  healthScore: number;
  /** Component scores in the same weight order for summary displays. */
  componentScores: {
    deadlineRiskScore: number;
    velocityTrendScore: number;
    sprintPredictabilityScore: number;
    overdueRateScore: number;
  };
  /** Total weight sum (should equal 100 unless weights are overridden). */
  totalWeight: number;
  /** Optional project-scoped weights used in the calculation. */
  weights?: HealthScoreWeights;
}

export function computeScheduleHealth({
  daysAtRisk,
  velocity,
  prevVelocity,
  predictabilityPct,
  overdueRate,
  weights = DEFAULT_HEALTH_SCORE_WEIGHTS,
}: {
  daysAtRisk: number | null;
  velocity: number;
  prevVelocity: number;
  predictabilityPct: number | null;
  overdueRate: number | null;
  weights?: HealthScoreWeights;
}): ScheduleHealthResult {
  // ----- deadline risk component -----
  const tier = (daysAtRisk !== null) ? deadlineRiskTier(daysAtRisk) : 0;
  const deadlineRiskScore = (tier === 0) ? 100 : (tier === 1) ? 60 : 0;

  // ----- velocity trend component -----
  const dir = (velocity !== 0 && prevVelocity !== 0) ? velocityDirection(velocity, prevVelocity) : (velocity > prevVelocity ? 1 : velocity < prevVelocity ? -1 : 0);
  const velocityTrendScore = dir === 1
    ? 100
    : (dir === 0 ? 80 : 50);

  // ----- sprint predictability component -----
  const sprintPredictabilityScore = metricContributionScore(predictabilityPct);

  // ----- overdue rate component -----
  const overdueRateScore = metricContributionScore(overdueRate);

  // ----- merged health score -----
  const deadlineRiskContribution = weights.deadlineRisk * (deadlineRiskScore / 100);
  const velocityContribution = weights.velocityTrend * (velocityTrendScore / 100);
  const predictabilityContribution = weights.sprintPredictability * (sprintPredictabilityScore / 100);
  const overdueContribution = weights.overdueRate * (overdueRateScore / 100);

  const totalWeight = weights.deadlineRisk + weights.velocityTrend + weights.sprintPredictability + weights.overdueRate;
  const healthScore = totalWeight === 0 ? 0 : Math.round(
    deadlineRiskContribution + velocityContribution + predictabilityContribution + overdueContribution
  );

  return {
    healthScore: Math.max(0, Math.min(100, healthScore)),
    componentScores: { deadlineRiskScore, velocityTrendScore, sprintPredictabilityScore, overdueRateScore },
    totalWeight,
    weights,
  };
}

/**
 * Get the color code (hex) for a healthScore in [0–100] per FR-5.3.
 * Returns the same convention as chartColors used by the platform.
 */
export function healthScoreColor(score: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  if (clamped >= 80) return '#22c55e'; // green (FR-5 Green as per existing schema)
  if (clamped >= 60) return '#eab308'; // amber
  return '#ef4444'; // red
}