import { describe, expect, it } from 'vitest';
import {
  ZERO_PRICE,
  estimateCostUsd,
  isFreePrice,
  isModelTier,
  perMillionToPerToken,
  perTokenToPerMillion,
  residencyOf,
  resolveModelTier,
  tierForPrice,
  tierRank,
} from './index.js';

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

describe('per-million price conversion', () => {
  it('converts a rate card to the per-token port price and back', () => {
    expect(perMillionToPerToken(3)).toBeCloseTo(3e-6, 15);
    expect(perTokenToPerMillion(15e-6)).toBeCloseTo(15, 9);
    expect(perTokenToPerMillion(perMillionToPerToken(0.45))).toBeCloseTo(0.45, 9);
  });
});

describe('tierForPrice — the price-band fallback, cut on output per million', () => {
  const perMillion = (input: number, output: number) => ({
    input: perMillionToPerToken(input),
    output: perMillionToPerToken(output),
  });
  it('cuts the ladder at 0 / 8 / 20 per million output tokens', () => {
    expect(tierForPrice(ZERO_PRICE)).toBe('FREE');
    expect(tierForPrice(perMillion(0.45, 2))).toBe('STANDARD');
    expect(tierForPrice(perMillion(0.1, 0.5))).toBe('STANDARD'); // Haiku 5.5
    expect(tierForPrice(perMillion(2, 10))).toBe('PREMIUM'); // Sonnet 5.5
    expect(tierForPrice(perMillion(3, 15))).toBe('PREMIUM');
    expect(tierForPrice(perMillion(4, 20))).toBe('ULTRA'); // Opus 5.5
    expect(tierForPrice(perMillion(10, 50))).toBe('ULTRA'); // Fable 5.1
  });
  it('is not FREE when only one side is free', () => {
    expect(tierForPrice(perMillion(0, 1))).toBe('STANDARD');
  });
});

describe('resolveModelTier — catalog tier first, price band second, else unknown', () => {
  it('prefers the catalog tier over the price', () => {
    expect(resolveModelTier({ catalogTier: 'PREMIUM', price: ZERO_PRICE })).toBe('PREMIUM');
  });
  it('falls back to the price band when the catalog has no tier', () => {
    expect(resolveModelTier({ price: { input: 4e-6, output: 20e-6 } })).toBe('ULTRA');
  });
  it('knows no tier without either — never a guess', () => {
    expect(resolveModelTier({})).toBeUndefined();
  });
});
