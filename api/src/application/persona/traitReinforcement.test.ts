import { describe, it, expect } from 'vitest';
import { PSYCH_DIM } from '@builderforce/agent-tools';
import {
  proposeTraitReinforcement,
  applyDeltas,
  DEFAULT_MIN_RUNS,
  MAX_DELTA_PER_DIM,
  MAX_PERIOD_ABS,
  type RunOutcomeSignal,
} from './traitReinforcement';

/** Build a homogeneous batch of `n` signals from a partial template. */
function batch(n: number, s: Partial<RunOutcomeSignal>): RunOutcomeSignal[] {
  const base: RunOutcomeSignal = {
    succeeded: true,
    toolErrorRate: 0,
    humanAccepted: true,
    humanRejected: false,
    retries: 1,
  };
  return Array.from({ length: n }, () => ({ ...base, ...s }));
}

describe('proposeTraitReinforcement', () => {
  it('proposes nothing below the minimum run count', () => {
    const { deltas } = proposeTraitReinforcement({}, batch(DEFAULT_MIN_RUNS - 1, { toolErrorRate: 1, succeeded: false }));
    expect(Object.keys(deltas)).toHaveLength(0);
  });

  it('nudges conscientiousness + reflection UP on repeated tool errors, and stays bounded', () => {
    const { deltas, rationale } = proposeTraitReinforcement({}, batch(10, { toolErrorRate: 1, succeeded: false, humanAccepted: false }));
    expect(deltas[PSYCH_DIM.conscientiousness]).toBeGreaterThan(0);
    expect(deltas[PSYCH_DIM.reflection]).toBeGreaterThan(0);
    expect(rationale.length).toBeGreaterThan(0);
    for (const d of Object.values(deltas)) expect(Math.abs(d)).toBeLessThanOrEqual(MAX_DELTA_PER_DIM);
  });

  it('lowers grit + raises emotionality when retries burn without success', () => {
    const { deltas } = proposeTraitReinforcement({}, batch(10, { retries: 40, succeeded: false, humanAccepted: false }));
    expect(deltas[PSYCH_DIM.grit]).toBeLessThan(0);
    expect(deltas[PSYCH_DIM.emotionality]).toBeGreaterThan(0);
  });

  it('lowers risk tolerance only when the agent is currently risk-seeking and gets rejected', () => {
    const rejected = batch(10, { succeeded: false, humanAccepted: false, humanRejected: true });
    const riskSeeking = proposeTraitReinforcement({ [PSYCH_DIM.riskTolerance]: 90 }, rejected);
    expect(riskSeeking.deltas[PSYCH_DIM.riskTolerance]).toBeLessThan(0);
    // A risk-averse agent should NOT get its (already low) risk pushed down for rejections.
    const riskAverse = proposeTraitReinforcement({ [PSYCH_DIM.riskTolerance]: 20 }, rejected);
    expect(riskAverse.deltas[PSYCH_DIM.riskTolerance]).toBeUndefined();
  });

  it('gently reinforces grit + ownership when runs succeed and are accepted', () => {
    const { deltas } = proposeTraitReinforcement({}, batch(10, { succeeded: true, humanAccepted: true, humanRejected: false }));
    expect(deltas[PSYCH_DIM.grit]).toBeGreaterThan(0);
    expect(deltas[PSYCH_DIM.locusInternal]).toBeGreaterThan(0);
  });

  it('every proposed delta is an integer within the per-dimension cap', () => {
    const { deltas } = proposeTraitReinforcement({}, batch(20, { toolErrorRate: 1, succeeded: false, retries: 50, humanRejected: true, humanAccepted: false }));
    for (const d of Object.values(deltas)) {
      expect(Number.isInteger(d)).toBe(true);
      expect(Math.abs(d)).toBeLessThanOrEqual(MAX_DELTA_PER_DIM);
    }
  });

  it('respects the cumulative period cap using prior applied deltas', () => {
    // Already at the ceiling for conscientiousness this period → no further push.
    const atCeiling = proposeTraitReinforcement({}, batch(10, { toolErrorRate: 1, succeeded: false, humanAccepted: false }), {
      priorAppliedThisPeriod: { [PSYCH_DIM.conscientiousness]: MAX_PERIOD_ABS },
    });
    expect(atCeiling.deltas[PSYCH_DIM.conscientiousness]).toBeUndefined();

    // Partway to the ceiling → the new push is clamped so prior+new never exceeds it.
    const partial = proposeTraitReinforcement({}, batch(10, { toolErrorRate: 1, succeeded: false, humanAccepted: false }), {
      priorAppliedThisPeriod: { [PSYCH_DIM.conscientiousness]: MAX_PERIOD_ABS - 1 },
    });
    const applied = partial.deltas[PSYCH_DIM.conscientiousness] ?? 0;
    expect(applied).toBeLessThanOrEqual(1);
    expect(applied + (MAX_PERIOD_ABS - 1)).toBeLessThanOrEqual(MAX_PERIOD_ABS);
  });
});

describe('applyDeltas', () => {
  it('clamps resulting scores to 0..100 and starts absent dims from neutral', () => {
    const out = applyDeltas({ [PSYCH_DIM.grit]: 99 }, { [PSYCH_DIM.grit]: 5, [PSYCH_DIM.reflection]: 3 });
    expect(out[PSYCH_DIM.grit]).toBe(100); // 99 + 5 clamped to 100
    expect(out[PSYCH_DIM.reflection]).toBe(53); // absent → neutral(50) + 3
  });

  it('clamps at the low bound and never mutates the input vector', () => {
    const input = { [PSYCH_DIM.riskTolerance]: 1 };
    const out = applyDeltas(input, { [PSYCH_DIM.riskTolerance]: -10 });
    expect(out[PSYCH_DIM.riskTolerance]).toBe(0);
    expect(input[PSYCH_DIM.riskTolerance]).toBe(1); // unchanged
  });

  it('is a round-trip inverse for a reversal delta (reversibility)', () => {
    const before = { [PSYCH_DIM.conscientiousness]: 50 };
    const forward = applyDeltas(before, { [PSYCH_DIM.conscientiousness]: 3 });
    const back = applyDeltas(forward, { [PSYCH_DIM.conscientiousness]: -3 });
    expect(back[PSYCH_DIM.conscientiousness]).toBe(50);
  });
});
