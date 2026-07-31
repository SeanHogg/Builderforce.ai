import { describe, expect, it } from 'vitest';
import { computeOutcomeScore, finalizeLearnWeight, runProducedOutput, SCORE_WEIGHTS, EFFICIENCY_STEP_NORM, type OutcomeScoreInputs } from './scoreRunOutcome';

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

describe('finalizeLearnWeight (Evermind contribution weight by run quality)', () => {
  const s = { merged: false, prOpened: false, autoMergeFailed: false, producedChanges: false };

  it('ranks merged > opened > wrote-files > no-op', () => {
    const merged = finalizeLearnWeight({ ...s, merged: true });
    const opened = finalizeLearnWeight({ ...s, prOpened: true });
    const wrote = finalizeLearnWeight({ ...s, producedChanges: true });
    const noop = finalizeLearnWeight(s);
    expect(merged).toBeGreaterThan(opened);
    expect(opened).toBeGreaterThan(wrote);
    expect(wrote).toBeGreaterThan(noop);
  });

  it('a broken auto-merge weighs below an open PR', () => {
    expect(finalizeLearnWeight({ ...s, prOpened: true, autoMergeFailed: true }))
      .toBeLessThan(finalizeLearnWeight({ ...s, prOpened: true }));
  });

  it('always clears the coordinator weight>0 gate and stays within (0,1]', () => {
    for (const merged of [true, false]) {
      for (const prOpened of [true, false]) {
        for (const autoMergeFailed of [true, false]) {
          for (const producedChanges of [true, false]) {
            const w = finalizeLearnWeight({ merged, prOpened, autoMergeFailed, producedChanges });
            expect(w).toBeGreaterThan(0);
            expect(w).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

/**
 * THE VERDICT THE PLATFORM ALREADY HAD AND THREW AWAY (0385).
 *
 * `finalizeLearnWeight` has graded every run "merged > opened > wrote-files > no-op"
 * since it replaced text length as the Evermind teaching weight — so the platform always
 * knew which runs accomplished nothing. It spent that verdict on teaching the model and
 * never on the one decision that would have stopped the burn: whether to dispatch the
 * ticket AGAIN. The autonomy breaker counted `status === 'failed'` alone, so on a board
 * where everything completed it never armed: 5,931 completed runs and 10 failures in one
 * day on project 11, against 3 finished tickets, one agent at 5,796 runs / 0 finished.
 *
 * `runProducedOutput` reads the SAME facts as the learn weight, which is the property
 * worth pinning — two graders of the same run that can disagree are how this comes back.
 */
describe('runProducedOutput', () => {
  it('counts any artifact at all — deliberately generous', () => {
    expect(runProducedOutput({ merged: true, prOpened: false, producedChanges: false })).toBe(true);
    expect(runProducedOutput({ merged: false, prOpened: true, producedChanges: false })).toBe(true);
    expect(runProducedOutput({ merged: false, prOpened: false, producedChanges: true })).toBe(true);
    expect(runProducedOutput({ merged: false, prOpened: false, producedChanges: false, movedTicket: true })).toBe(true);
  });

  it('is false ONLY for a run with nothing to show for itself', () => {
    expect(runProducedOutput({ merged: false, prOpened: false, producedChanges: false })).toBe(false);
    expect(runProducedOutput({ merged: false, prOpened: false, producedChanges: false, movedTicket: false })).toBe(false);
  });

  /**
   * The two graders must not drift apart. `finalizeLearnWeight` floors an unproductive
   * run at its lowest weight (0.2) — so "the learn weight bottomed out" and "the run
   * produced nothing" have to be the same set of runs, or one of them is lying.
   */
  it('agrees with the learn weight about which runs accomplished nothing', () => {
    for (const merged of [true, false]) {
      for (const prOpened of [true, false]) {
        for (const producedChanges of [true, false]) {
          const s = { merged, prOpened, producedChanges };
          const weight = finalizeLearnWeight({ ...s, autoMergeFailed: false });
          expect(runProducedOutput(s), JSON.stringify(s)).toBe(weight > 0.2);
        }
      }
    }
  });
});
