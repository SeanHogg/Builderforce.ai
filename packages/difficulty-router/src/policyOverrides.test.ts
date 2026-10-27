import { describe, expect, it } from 'vitest';
import { DIFFICULTY_POLICY, difficultyPolicyWith } from './index.js';

describe('difficultyPolicyWith', () => {
  it('defaults to the shipped policy', () => {
    expect(difficultyPolicyWith()).toEqual(DIFFICULTY_POLICY);
  });

  it('takes valid overrides and ignores out-of-range ones', () => {
    const p = difficultyPolicyWith({ skipAbove: 0.9, explore: 2, minSamples: -1, maxHoldoutLoss: 0 });
    expect(p.skipAbove).toBe(0.9);
    expect(p.explore).toBe(DIFFICULTY_POLICY.explore);
    expect(p.minSamples).toBe(DIFFICULTY_POLICY.minSamples);
    expect(p.maxHoldoutLoss).toBe(DIFFICULTY_POLICY.maxHoldoutLoss);
  });
});
