/**
 * Tests for Schedule Health computation library per PRD #296.
 *
 * Covers: deadlineRiskTier, daysAtRisk, velocityDirection, velocityForecastBand,
 * isVelocityAnomalous, overdueAgingBucket, overdueRatePct, sprintPredictabilityPct,
 * sprintPredictabilityClass, sprintCommitmentTrend, computeScheduleHealth,
 * healthScoreColor, healthScoreTier, healthScoreTrend.
 */
import { describe, it, expect } from 'vitest';
import {
  deadlineRiskTier,
  deadlineRiskLabel,
  daysAtRisk,
  velocityDirection,
  velocityDirectionLabel,
  velocityForecastBand,
  isVelocityAnomalous,
  overdueAgingBucket,
  overdueRatePct,
  sprintPredictabilityPct,
  sprintPredictabilityClass,
  sprintCommitmentTrend,
  computeScheduleHealth,
  healthScoreColor,
  healthScoreTier,
  healthScoreTrend,
  DEFAULT_HEALTH_SCORE_WEIGHTS,
} from './scheduleHealth';

// ---------------------------------------------------------------------------
// FR-1: Deadline Risk
// ---------------------------------------------------------------------------

describe('deadlineRiskTier', () => {
  it('classifies ≤ 0 days at risk as On Track (tier 0)', () => {
    expect(deadlineRiskTier(-10)).toBe(0);
    expect(deadlineRiskTier(-1)).toBe(0);
    expect(deadlineRiskTier(0)).toBe(0);
  });

  it('classifies 1–7 days at risk as At Risk (tier 1)', () => {
    expect(deadlineRiskTier(1)).toBe(1);
    expect(deadlineRiskTier(4)).toBe(1);
    expect(deadlineRiskTier(7)).toBe(1);
  });

  it('classifies > 7 days at risk as Off Track (tier 2)', () => {
    expect(deadlineRiskTier(8)).toBe(2);
    expect(deadlineRiskTier(30)).toBe(2);
  });
});

describe('deadlineRiskLabel', () => {
  it('maps tiers to human labels', () => {
    expect(deadlineRiskLabel(0)).toBe('On Track');
    expect(deadlineRiskLabel(1)).toBe('At Risk');
    expect(deadlineRiskLabel(2)).toBe('Off Track');
  });
});

describe('daysAtRisk', () => {
  it('returns positive days when projected date is after deadline', () => {
    const deadline = new Date('2026-07-01');
    const projected = new Date('2026-07-11');
    expect(daysAtRisk(deadline, projected)).toBe(10);
  });

  it('returns negative days when projected date is before deadline (buffer)', () => {
    const deadline = new Date('2026-07-15');
    const projected = new Date('2026-07-10');
    expect(daysAtRisk(deadline, projected)).toBe(-5);
  });

  it('returns zero when dates match', () => {
    const d = new Date('2026-07-01');
    expect(daysAtRisk(d, d)).toBe(0);
  });

  it('returns null when either date is null', () => {
    expect(daysAtRisk(null, new Date())).toBeNull();
    expect(daysAtRisk(new Date(), null)).toBeNull();
    expect(daysAtRisk(null, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FR-2: Velocity Trending
// ---------------------------------------------------------------------------

describe('velocityDirection', () => {
  it('returns improving (1) when velocity increases > +10%', () => {
    expect(velocityDirection(25, 20)).toBe(1); // +25%
  });

  it('returns stable (0) when velocity is within ±10%', () => {
    expect(velocityDirection(21, 20)).toBe(0);  // +5%
    expect(velocityDirection(20, 20)).toBe(0);  //  0%
    expect(velocityDirection(19, 20)).toBe(0);  // −5%
    expect(velocityDirection(18, 20)).toBe(0);  // −10% → boundary, stable
  });

  it('returns declining (−1) when velocity drops > −10%', () => {
    expect(velocityDirection(17, 20)).toBe(-1); // −15%
    expect(velocityDirection(10, 20)).toBe(-1); // −50%
  });

  it('handles zero prevVelocity: positive avg → improving', () => {
    expect(velocityDirection(10, 0)).toBe(1);
  });

  it('handles zero avgVelocity: positive prev → declining', () => {
    expect(velocityDirection(0, 10)).toBe(-1);
  });

  it('both zero → stable', () => {
    expect(velocityDirection(0, 0)).toBe(0);
  });
});

describe('velocityDirectionLabel', () => {
  it('maps directions to labels', () => {
    expect(velocityDirectionLabel(1)).toBe('improving');
    expect(velocityDirectionLabel(0)).toBe('stable');
    expect(velocityDirectionLabel(-1)).toBe('declining');
  });
});

describe('velocityForecastBand', () => {
  it('returns null for empty array', () => {
    expect(velocityForecastBand([])).toBeNull();
  });

  it('computes forecast band from historical velocities', () => {
    // mean = 20, std dev ≈ 7.07
    const band = velocityForecastBand([10, 20, 30]);
    expect(band).not.toBeNull();
    expect(band!.expected).toBe(20);
    expect(band!.optimistic).toBeGreaterThan(band!.expected);
    expect(band!.pessimistic).toBeLessThan(band!.expected);
  });

  it('handles a single sprint: stdDev = 0, all bands equal', () => {
    const band = velocityForecastBand([15]);
    expect(band).not.toBeNull();
    expect(band!.expected).toBe(15);
    expect(band!.optimistic).toBe(15);
    expect(band!.pessimistic).toBe(15);
  });

  it('pessimistic is never negative', () => {
    const band = velocityForecastBand([1, 2, 3]);
    expect(band!.pessimistic).toBeGreaterThanOrEqual(0);
  });
});

describe('isVelocityAnomalous', () => {
  it('flags sprint beyond 2σ as anomalous', () => {
    // mean=20, stdDev=5, 2σ range = 10–30
    expect(isVelocityAnomalous(35, 20, 5)).toBe(true);  // 3σ above
    expect(isVelocityAnomalous(5, 20, 5)).toBe(true);   // 3σ below
  });

  it('does not flag sprint within 2σ', () => {
    expect(isVelocityAnomalous(29, 20, 5)).toBe(false);
    expect(isVelocityAnomalous(20, 20, 5)).toBe(false);
  });

  it('returns false when stdDev is zero', () => {
    expect(isVelocityAnomalous(50, 20, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FR-3: Overdue Task Detection
// ---------------------------------------------------------------------------

describe('overdueAgingBucket', () => {
  it('1–3 days', () => {
    expect(overdueAgingBucket(1)).toBe('1-3 days');
    expect(overdueAgingBucket(3)).toBe('1-3 days');
  });

  it('4–7 days', () => {
    expect(overdueAgingBucket(4)).toBe('4-7 days');
    expect(overdueAgingBucket(7)).toBe('4-7 days');
  });

  it('8–14 days', () => {
    expect(overdueAgingBucket(8)).toBe('8-14 days');
    expect(overdueAgingBucket(14)).toBe('8-14 days');
  });

  it('15+ days', () => {
    expect(overdueAgingBucket(15)).toBe('15+ days');
    expect(overdueAgingBucket(60)).toBe('15+ days');
  });
});

describe('overdueRatePct', () => {
  it('calculates overdue rate as integer percent', () => {
    expect(overdueRatePct(5, 20)).toBe(25);  // 5/20 = 25%
  });

  it('returns 0 when total is 0', () => {
    expect(overdueRatePct(0, 0)).toBe(0);
    expect(overdueRatePct(5, 0)).toBe(0);
  });

  it('returns 100 when all tasks are overdue', () => {
    expect(overdueRatePct(10, 10)).toBe(100);
  });

  it('rounds to nearest integer', () => {
    // 1/3 = 33.33% → 33
    expect(overdueRatePct(1, 3)).toBe(33);
  });
});

// ---------------------------------------------------------------------------
// FR-4: Sprint Predictability
// ---------------------------------------------------------------------------

describe('sprintPredictabilityPct', () => {
  it('computes completed / committed × 100', () => {
    expect(sprintPredictabilityPct(8, 10)).toBe(80);
  });

  it('returns null when no points committed', () => {
    expect(sprintPredictabilityPct(0, 0)).toBeNull();
    expect(sprintPredictabilityPct(5, 0)).toBeNull();
  });

  it('returns 100 when all committed points completed', () => {
    expect(sprintPredictabilityPct(20, 20)).toBe(100);
  });

  it('rounds to integer', () => {
    // 2/3 = 66.67% → 67
    expect(sprintPredictabilityPct(2, 3)).toBe(67);
  });
});

describe('sprintPredictabilityClass', () => {
  it('Highly Predictable: ≥ 85%', () => {
    expect(sprintPredictabilityClass(85)).toBe('Highly Predictable');
    expect(sprintPredictabilityClass(100)).toBe('Highly Predictable');
  });

  it('Moderate: 65–84%', () => {
    expect(sprintPredictabilityClass(65)).toBe('Moderate');
    expect(sprintPredictabilityClass(84)).toBe('Moderate');
  });

  it('Unpredictable: < 65%', () => {
    expect(sprintPredictabilityClass(64)).toBe('Unpredictable');
    expect(sprintPredictabilityClass(0)).toBe('Unpredictable');
  });
});

describe('sprintCommitmentTrend', () => {
  it('balanced when empty', () => {
    expect(sprintCommitmentTrend([])).toBe('balanced');
  });

  it('balanced when sprints are within 85–115%', () => {
    expect(sprintCommitmentTrend([
      { committedPoints: 10, completedPoints: 9 },
      { committedPoints: 10, completedPoints: 10 },
      { committedPoints: 10, completedPoints: 11 },
    ])).toBe('balanced');
  });

  it('over-committing when majority of sprints < 85%', () => {
    expect(sprintCommitmentTrend([
      { committedPoints: 10, completedPoints: 5 },
      { committedPoints: 10, completedPoints: 6 },
      { committedPoints: 10, completedPoints: 10 },
    ])).toBe('over-committing');
  });

  it('under-committing when majority of sprints > 115%', () => {
    expect(sprintCommitmentTrend([
      { committedPoints: 10, completedPoints: 12 },
      { committedPoints: 10, completedPoints: 14 },
      { committedPoints: 10, completedPoints: 8 },
    ])).toBe('under-committing');
  });

  it('ignores sprints with zero committed points', () => {
    expect(sprintCommitmentTrend([
      { committedPoints: 0, completedPoints: 0 },
      { committedPoints: 10, completedPoints: 5 },
      { committedPoints: 10, completedPoints: 5 },
    ])).toBe('over-committing');
  });
});

// ---------------------------------------------------------------------------
// FR-5: Aggregate Schedule Health Score
// ---------------------------------------------------------------------------

describe('computeScheduleHealth', () => {
  it('returns 100 for perfect inputs', () => {
    const result = computeScheduleHealth({
      daysAtRisk: -5,          // On Track → 100
      velocity: 25,            // improving → 100
      prevVelocity: 20,
      predictabilityPct: 95,   // 95
      overdueRatePct: 0,       // 100 − 0 = 100
    });
    expect(result.healthScore).toBeGreaterThanOrEqual(95);
    expect(result.componentScores.deadlineRiskScore).toBe(100);
    expect(result.componentScores.velocityTrendScore).toBe(100);
  });

  it('returns low score for bad inputs', () => {
    const result = computeScheduleHealth({
      daysAtRisk: 10,          // Off Track → 0
      velocity: 5,             // declining → 50
      prevVelocity: 10,
      predictabilityPct: 50,   // 50
      overdueRatePct: 50,      // 100 − 50 = 50
    });
    expect(result.healthScore).toBeLessThan(60);
    expect(result.componentScores.deadlineRiskScore).toBe(0);
  });

  it('uses custom weights when provided', () => {
    const customWeights = { deadlineRisk: 100, velocityTrend: 0, sprintPredictability: 0, overdueRate: 0 };
    const result = computeScheduleHealth({
      daysAtRisk: -1,
      velocity: 25,
      prevVelocity: 20,
      predictabilityPct: 50,
      overdueRatePct: 50,
      weights: customWeights,
    });
    // Only deadlineRisk matters: tier 0 → 100
    expect(result.healthScore).toBe(100);
  });

  it('handles null inputs gracefully', () => {
    const result = computeScheduleHealth({
      daysAtRisk: null,
      velocity: 0,
      prevVelocity: 0,
      predictabilityPct: null,
      overdueRatePct: null,
    });
    expect(result.healthScore).toBeGreaterThanOrEqual(0);
    expect(result.healthScore).toBeLessThanOrEqual(100);
  });

  it('healthScore is always clamped to 0–100', () => {
    const result = computeScheduleHealth({
      daysAtRisk: -100,
      velocity: 100,
      prevVelocity: 1,
      predictabilityPct: 100,
      overdueRatePct: 0,
    });
    expect(result.healthScore).toBeGreaterThanOrEqual(0);
    expect(result.healthScore).toBeLessThanOrEqual(100);
  });
});

describe('healthScoreColor', () => {
  it('green for ≥ 80', () => {
    expect(healthScoreColor(80)).toBe('#22c55e');
    expect(healthScoreColor(100)).toBe('#22c55e');
  });

  it('amber for 60–79', () => {
    expect(healthScoreColor(60)).toBe('#eab308');
    expect(healthScoreColor(79)).toBe('#eab308');
  });

  it('red for < 60', () => {
    expect(healthScoreColor(59)).toBe('#ef4444');
    expect(healthScoreColor(0)).toBe('#ef4444');
  });
});

describe('healthScoreTier', () => {
  it('maps scores to tiers', () => {
    expect(healthScoreTier(85)).toBe('Green');
    expect(healthScoreTier(80)).toBe('Green');
    expect(healthScoreTier(70)).toBe('Amber');
    expect(healthScoreTier(60)).toBe('Amber');
    expect(healthScoreTier(50)).toBe('Red');
  });
});

describe('healthScoreTrend', () => {
  it('improving when score increased > 3 points', () => {
    expect(healthScoreTrend(80, 70)).toBe('improving');
  });

  it('declining when score dropped > 3 points', () => {
    expect(healthScoreTrend(70, 80)).toBe('declining');
  });

  it('stable when within ±3 points', () => {
    expect(healthScoreTrend(80, 78)).toBe('stable');
    expect(healthScoreTrend(80, 82)).toBe('stable');
    expect(healthScoreTrend(80, 80)).toBe('stable');
  });

  it('no_baseline when previous is null', () => {
    expect(healthScoreTrend(80, null)).toBe('no_baseline');
  });
});
