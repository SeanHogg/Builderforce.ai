import { describe, expect, it } from 'vitest';
import { computeOutcomeScore, SCORE_WEIGHTS, EFFICIENCY_STEP_NORM, type OutcomeScoreInputs } from './scoreRunOutcome';

const base: OutcomeScoreInputs = {
  terminalStatus: 'completed',
  merged: false,
  ciGreen: false,
  degraded: false,
  steps: 0,
  costMc: 0,
  approved: false,
};

describe('computeOutcomeScore (D3)', () => {
  it('merged + green CI + no degradation + efficient ≈ near-perfect', () => {
    const { score } = computeOutcomeScore({ ...base, merged: true, ciGreen: true, steps: 0, costMc: 0 });
    // 0.5 + 0.2 + 0.15 + 0.15 = 1.0
    expect(score).toBeCloseTo(1.0, 6);
  });

  it('a failed run scores exactly 0 (no merge/CI/completion credit)', () => {
    const { score, terms } = computeOutcomeScore({ ...base, terminalStatus: 'failed', merged: true, ciGreen: true });
    expect(score).toBe(0);
    expect(terms).toEqual({ merge: 0, ci: 0, completion: 0, efficiency: 0 });
  });

  it('a cancelled run scores exactly 0', () => {
    expect(computeOutcomeScore({ ...base, terminalStatus: 'cancelled' }).score).toBe(0);
  });

  it('degradation removes the completion term', () => {
    const clean = computeOutcomeScore({ ...base, merged: true, ciGreen: true, degraded: false }).score;
    const degraded = computeOutcomeScore({ ...base, merged: true, ciGreen: true, degraded: true }).score;
    expect(degraded).toBeCloseTo(clean - SCORE_WEIGHTS.completion, 6);
  });

  it('a human approval pins the completion term to full even when degraded', () => {
    const degradedApproved = computeOutcomeScore({ ...base, merged: true, ciGreen: true, degraded: true, approved: true }).score;
    const cleanNoApprove = computeOutcomeScore({ ...base, merged: true, ciGreen: true, degraded: false }).score;
    expect(degradedApproved).toBeCloseTo(cleanNoApprove, 6);
  });

  it('efficiency rewards fewer steps and lower cost', () => {
    const fast = computeOutcomeScore({ ...base, steps: 0, costMc: 0 }).terms.efficiency;
    const slow = computeOutcomeScore({ ...base, steps: EFFICIENCY_STEP_NORM, costMc: 0 }).terms.efficiency;
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeCloseTo(0.5, 6); // step half = 0, cost half = 1 → 0.5
  });

  it('the merge term dominates the score weighting', () => {
    const merged = computeOutcomeScore({ ...base, merged: true }).terms.merge;
    expect(merged).toBe(1);
    // A merged-only completed run earns at least the merge weight.
    expect(computeOutcomeScore({ ...base, merged: true }).score).toBeGreaterThanOrEqual(SCORE_WEIGHTS.merge);
  });

  it('score is always within [0,1]', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      for (const merged of [true, false]) {
        for (const degraded of [true, false]) {
          const { score } = computeOutcomeScore({ ...base, terminalStatus: status, merged, ciGreen: merged, degraded, steps: 99, costMc: 999_999 });
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
