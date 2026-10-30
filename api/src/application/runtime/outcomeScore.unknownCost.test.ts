/**
 * A run that reported no cost is unknown, not free: it scores its efficiency on steps alone, so it
 * cannot earn the cost half of efficiency that a run which really cost nothing earns.
 */
import { describe, expect, it } from 'vitest';
import { computeOutcomeScore, EFFICIENCY_STEP_NORM, SCORE_WEIGHTS, type OutcomeScoreInputs } from './outcomeScore';

const base: OutcomeScoreInputs = {
  terminalStatus: 'completed', merged: false, ciGreen: false, degraded: false, steps: 0, approved: false,
};

describe('computeOutcomeScore — an unreported cost', () => {
  it('scores efficiency on steps alone: no cost half, so no free-run bonus', () => {
    const unknown = computeOutcomeScore({ ...base, steps: EFFICIENCY_STEP_NORM / 2, costMc: null });

    expect(unknown.terms.efficiency).toBeCloseTo(0.5, 6);
  });

  it('absent and null are the same unknown', () => {
    const absent = computeOutcomeScore({ ...base, steps: 10 });
    const nulled = computeOutcomeScore({ ...base, steps: 10, costMc: null });

    expect(absent).toEqual(nulled);
  });

  it('does not let an unpriced run outscore a run that reported a real cost at the same steps — only a free one', () => {
    const steps = EFFICIENCY_STEP_NORM / 2;
    const unknown = computeOutcomeScore({ ...base, steps, costMc: null }).score;
    const free = computeOutcomeScore({ ...base, steps, costMc: 0 }).score;
    const dear = computeOutcomeScore({ ...base, steps, costMc: 200_000 }).score;

    // A run that really cost nothing earns the full cost half; an unknown one earns the step half only.
    expect(free).toBeGreaterThan(unknown);
    expect(free - unknown).toBeCloseTo(SCORE_WEIGHTS.efficiency * 0.25, 6);
    // And the unknown run is not punished as if it were expensive.
    expect(unknown).toBeGreaterThan(dear);
  });

  it('is unchanged for a run that reported a cost', () => {
    const { terms } = computeOutcomeScore({ ...base, steps: 0, costMc: 0 });

    expect(terms.efficiency).toBe(1);
  });
});
