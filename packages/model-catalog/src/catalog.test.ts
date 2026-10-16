import { describe, expect, it } from 'vitest';
import { ZERO_PRICE, estimateCostUsd, isFreePrice, isModelTier, residencyOf, tierRank } from './index.js';

describe('tierRank', () => {
  it('ranks strongest first and unknown last', () => {
    expect(tierRank('ULTRA')).toBe(0);
    expect(tierRank('FREE')).toBe(3);
    expect(tierRank(undefined)).toBe(4);
    expect(tierRank('MYSTERY')).toBe(4);
  });
  it('recognises tiers', () => {
    expect(isModelTier('PREMIUM')).toBe(true);
    expect(isModelTier('premium')).toBe(false);
  });
});

describe('estimateCostUsd', () => {
  it('prices input and output separately', () => {
    expect(estimateCostUsd({ input: 1e-6, output: 4e-6 }, 1000, 500)).toBeCloseTo(0.003, 9);
  });
  it('treats bad token counts as zero rather than NaN', () => {
    expect(estimateCostUsd({ input: 1, output: 1 }, Number.NaN, -5)).toBe(0);
  });
  it('knows a free price', () => {
    expect(isFreePrice(ZERO_PRICE)).toBe(true);
    expect(isFreePrice({ input: 0, output: 1e-9 })).toBe(false);
  });
});

describe('residencyOf', () => {
  it('defaults to cloud when the host does not say', () => {
    expect(residencyOf({ vendorOf: () => 'x', tierOf: () => undefined }, 'm')).toBe('cloud');
    expect(residencyOf({ vendorOf: () => 'x', tierOf: () => undefined, residencyOf: () => 'local' }, 'm')).toBe('local');
  });
});
