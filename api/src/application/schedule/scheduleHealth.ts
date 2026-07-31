/**
 * Schedule Health computation library — the single server-side source for all
 * Schedule Health metrics requested by FR-1..FR-5 in PRD #296.
 *
 * Pure functions: no DB access, no side effects. The DB-backed service that
 * feeds these lives in {@link ./scheduleHealthService}.
 *
 * Definitions (all integer or plain-number, no fractions unless specified):
 *   - daysAtRiskRaw = projectedEndDate - committedDeadline (in days, may be negative)
 *   - velocity (story points per sprint, integer)
 *   - days in forecast horizon (integer)
 *   - overdueTaskCount (integer)
 *   - totalTaskCountInPeriod (integer)
 *   - predictabilityPct = completedPoints / committedPoints (%, 0–100)
 */

// ---------------------------------------------------------------------------
// FR-1: Deadline Risk
// ---------------------------------------------------------------------------

/**
 * Deadline risk tier per PRD FR-1.3:
 *   0 = On Track (≤ 0 days at risk)
 *   1 = At Risk (1–7 days)
 *   2 = Off Track (> 7 days)
 */
export function deadlineRiskTier(daysAtRisk: number): 0 | 1 | 2 {
  if (daysAtRisk <= 0) return 0;
  if (daysAtRisk <= 7) return 1;
  return 2;
}

/** Human label for a tier (UX). */
export function deadlineRiskLabel(tier: 0 | 1 | 2): string {
  switch (tier) {
    case 0: return 'On Track';
    case 1: return 'At Risk';
    case 2: return 'Off Track';
  }
}

/**
 * Days At Risk delta per PRD FR-1.2 (negative = buffer, positive = slippage).
 * Null when either date is missing.
 */
export function daysAtRisk(
  committedDeadline: Date | null,
  projectedEndDate: Date | null,
): number | null {
  if (!committedDeadline || !projectedEndDate) return null;
  const diffMs = projectedEndDate.getTime() - committedDeadline.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

// ---------------------------------------------------------------------------
// FR-2: Velocity Trending
// ---------------------------------------------------------------------------

/**
 * Velocity trend direction per PRD FR-2.3:
 *   1  = improving  (velocity increased by more than +10%)
 *   0  = stable     (within ±10%)
 *   -1 = declining  (velocity dropped by more than −10%)
 *
 * When one of the velocities is zero we treat the absolute difference:
 *   - prevVelocity=0, avgVelocity>0  → improving
 *   - prevVelocity>0, avgVelocity=0  → declining
 *   - both 0                          → stable
 */
export function velocityDirection(avgVelocity: number, prevVelocity: number): 1 | 0 | -1 {
  // Degenerate: both zero → stable.
  if (avgVelocity === 0 && prevVelocity === 0) return 0;

  // prev zero, current positive → improving.
  if (prevVelocity === 0 && avgVelocity > 0) return 1;
  // current zero, prev positive → declining.
  if (avgVelocity === 0 && prevVelocity > 0) return -1;

  const pctChange = (avgVelocity - prevVelocity) / prevVelocity;

  // PRD: ±10% is the "stable" band.
  if (pctChange > 0.1) return 1;   // improving
  if (pctChange < -0.1) return -1; // declining
  return 0;                         // stable
}

/** Human label for velocity direction (UX). */
export function velocityDirectionLabel(dir: 1 | 0 | -1): string {
  switch (dir) {
    case 1: return 'improving';
    case 0: return 'stable';
    case -1: return 'declining';
  }
}

/**
 * Velocity forecast band per PRD FR-2.4.
 * Given historical sprint velocities, returns optimistic / expected / pessimistic
 * based on mean ± 1 standard deviation.
 */
export interface VelocityForecastBand {
  optimistic: number;
  expected: number;
  pessimistic: number;
}

export function velocityForecastBand(
  velocities: number[],
): VelocityForecastBand | null {
  if (!velocities.length) return null;
  const n = velocities.length;
  const mean = velocities.reduce((a, v) => a + v, 0) / n;
  const variance = n > 1
    ? velocities.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)
    : 0;
  const stdDev = Math.sqrt(variance);

  return {
    optimistic: Math.round(mean + stdDev),
    expected: Math.round(mean),
    pessimistic: Math.max(0, Math.round(mean - stdDev)),
  };
}

/**
 * Flag anomalous sprints per PRD FR-2.5: velocity > 2σ from mean.
 */
export function isVelocityAnomalous(
  sprintVelocity: number,
  mean: number,
  stdDev: number,
): boolean {
  if (stdDev === 0) return false;
  return Math.abs(sprintVelocity - mean) > 2 * stdDev;
}

// ---------------------------------------------------------------------------
// FR-3: Overdue Task Detection
// ---------------------------------------------------------------------------

/**
 * Overdue aging bucket per PRD FR-3.4.
 */
export type OverdueAgingBucket = '1-3 days' | '4-7 days' | '8-14 days' | '15+ days';

export function overdueAgingBucket(daysOverdue: number): OverdueAgingBucket {
  if (daysOverdue <= 3) return '1-3 days';
  if (daysOverdue <= 7) return '4-7 days';
  if (daysOverdue <= 14) return '8-14 days';
  return '15+ days';
}

/**
 * Overdue rate per PRD FR-3.3: (# overdue / total in period) × 100.
 * Returns 0 when total is 0 (no tasks → no overdue rate).
 */
export function overdueRatePct(overdueCount: number, totalCount: number): number {
  if (totalCount <= 0) return 0;
  return Math.round((overdueCount / totalCount) * 100);
}

// ---------------------------------------------------------------------------
// FR-4: Sprint Predictability
// ---------------------------------------------------------------------------

/**
 * Predictability classification per PRD FR-4.3.
 */
export type PredictabilityClass =
  | 'Highly Predictable'  // 85–100%
  | 'Moderate'            // 65–84%
  | 'Unpredictable';      // < 65%

export function sprintPredictabilityClass(
  predictabilityPct: number,
): PredictabilityClass {
  if (predictabilityPct >= 85) return 'Highly Predictable';
  if (predictabilityPct >= 65) return 'Moderate';
  return 'Unpredictable';
}

/**
 * Sprint predictability % per PRD FR-4.1.
 */
export function sprintPredictabilityPct(
  completedPoints: number,
  committedPoints: number,
): number | null {
  if (committedPoints <= 0) return null;
  return Math.round((completedPoints / committedPoints) * 100);
}

/**
 * Sprint commitment trend per PRD FR-4.5.
 * Given the last N sprints' committed vs completed points, classify whether
 * the team is consistently over-committing, balanced, or under-committing.
 *
 * "Consistently" = > 50% of sprints exhibit the pattern.
 */
export type CommitmentTrend = 'over-committing' | 'balanced' | 'under-committing';

export function sprintCommitmentTrend(
  sprints: Array<{ committedPoints: number; completedPoints: number }>,
): CommitmentTrend {
  if (!sprints.length) return 'balanced';

  let over = 0, under = 0;
  for (const s of sprints) {
    if (s.committedPoints === 0) continue;
    const ratio = s.completedPoints / s.committedPoints;
    // Over-committing: completed < 85% of committed (carry-over > 15%).
    if (ratio < 0.85) over++;
    // Under-committing: completed > 115% of committed (took on extra work).
    else if (ratio > 1.15) under++;
  }

  const total = sprints.length;
  if (over > total / 2) return 'over-committing';
  if (under > total / 2) return 'under-committing';
  return 'balanced';
}

// ---------------------------------------------------------------------------
// FR-5: Aggregate Schedule Health Score
// ---------------------------------------------------------------------------

export interface HealthScoreWeights {
  deadlineRisk: number;
  velocityTrend: number;
  sprintPredictability: number;
  overdueRate: number;
}

/** Default weights per PRD FR-5.1. */
export const DEFAULT_HEALTH_SCORE_WEIGHTS: HealthScoreWeights = {
  deadlineRisk: 40,
  velocityTrend: 30,
  sprintPredictability: 20,
  overdueRate: 10,
};

/**
 * Clamp a raw value into a 0–100 integer score.
 */
export function metricContributionScore(value: number | null | undefined): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export interface ScheduleHealthResult {
  healthScore: number;
  componentScores: {
    deadlineRiskScore: number;
    velocityTrendScore: number;
    sprintPredictabilityScore: number;
    overdueRateScore: number;
  };
  totalWeight: number;
  weights?: HealthScoreWeights;
}

/**
 * Compute the weighted Schedule Health Score per FR-5.1.
 *
 * Component mapping:
 *   - deadlineRisk:       tier 0 → 100, tier 1 → 60, tier 2 → 0
 *   - velocityTrend:      improving → 100, stable → 80, declining → 50
 *   - sprintPredictability: the raw predictability % (0–100), or 0 when null
 *   - overdueRate:         100 − overdueRatePct (so high overdue = low score)
 */
export function computeScheduleHealth({
  daysAtRisk,
  velocity,
  prevVelocity,
  predictabilityPct,
  overdueRatePct: overduePct,
  weights = DEFAULT_HEALTH_SCORE_WEIGHTS,
}: {
  daysAtRisk: number | null;
  velocity: number;
  prevVelocity: number;
  predictabilityPct: number | null;
  overdueRatePct: number | null;
  weights?: HealthScoreWeights;
}): ScheduleHealthResult {
  // ----- deadline risk component -----
  const tier = (daysAtRisk !== null) ? deadlineRiskTier(daysAtRisk) : 0;
  const deadlineRiskScore = tier === 0 ? 100 : tier === 1 ? 60 : 0;

  // ----- velocity trend component -----
  const dir = velocityDirection(velocity, prevVelocity);
  const velocityTrendScore = dir === 1 ? 100 : dir === 0 ? 80 : 50;

  // ----- sprint predictability component -----
  const sprintPredictabilityScore = metricContributionScore(predictabilityPct);

  // ----- overdue rate component (100 − rate, so lower overdue = higher score) -----
  const rawOverdue = metricContributionScore(overduePct);
  const overdueRateScore = 100 - rawOverdue;

  // ----- merged health score -----
  const totalWeight =
    weights.deadlineRisk + weights.velocityTrend +
    weights.sprintPredictability + weights.overdueRate;

  if (totalWeight === 0) {
    return {
      healthScore: 0,
      componentScores: {
        deadlineRiskScore,
        velocityTrendScore,
        sprintPredictabilityScore,
        overdueRateScore,
      },
      totalWeight,
      weights,
    };
  }

  const healthScore = Math.round(
    (weights.deadlineRisk * deadlineRiskScore +
      weights.velocityTrend * velocityTrendScore +
      weights.sprintPredictability * sprintPredictabilityScore +
      weights.overdueRate * overdueRateScore) /
      totalWeight,
  );

  return {
    healthScore: Math.max(0, Math.min(100, healthScore)),
    componentScores: {
      deadlineRiskScore,
      velocityTrendScore,
      sprintPredictabilityScore,
      overdueRateScore,
    },
    totalWeight,
    weights,
  };
}

/**
 * Color code for a healthScore in [0–100] per PRD FR-5.3.
 */
export function healthScoreColor(score: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  if (clamped >= 80) return '#22c55e'; // green
  if (clamped >= 60) return '#eab308'; // amber
  return '#ef4444'; // red
}

/** Health score tier label per PRD FR-5.3. */
export function healthScoreTier(score: number): 'Green' | 'Amber' | 'Red' {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  if (clamped >= 80) return 'Green';
  if (clamped >= 60) return 'Amber';
  return 'Red';
}

// ---------------------------------------------------------------------------
// FR-5.4: Score trend direction
// ---------------------------------------------------------------------------

/**
 * Health score trend direction relative to a prior score.
 * Returns the sign of the change.
 */
export function healthScoreTrend(
  currentScore: number,
  previousScore: number | null,
): 'improving' | 'stable' | 'declining' | 'no_baseline' {
  if (previousScore == null || !Number.isFinite(previousScore)) return 'no_baseline';
  const delta = currentScore - previousScore;
  if (delta > 3) return 'improving';
  if (delta < -3) return 'declining';
  return 'stable';
}
