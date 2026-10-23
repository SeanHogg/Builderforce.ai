import { describe, expect, it } from 'vitest';
import {
  estimateCostUsd,
  lowestTierBoundary,
  perMillionToPerToken,
  PRICE_TIERS,
  priceTierBoundary,
  priceTierFamily,
  rateForInput,
  withPriceTiers,
  type ModelPrice,
} from './index.js';

const M = perMillionToPerToken;

describe('price tier family keys', () => {
  it('every route to the same weights normalises to one key', () => {
    for (const id of ['gemini-2.5-pro', 'googleai/gemini-2.5-pro', 'google/gemini-2.5-pro', 'openrouter/google/gemini-2.5-pro', 'google/gemini-2.5-pro:free']) {
      expect(priceTierFamily(id)).toBe('gemini-2-5-pro');
    }
    expect(priceTierFamily('claude-sonnet-4-5-20250929')).toBe('claude-sonnet-4-5');
    expect(priceTierFamily('anthropic/claude-sonnet-4.5')).toBe('claude-sonnet-4-5');
    expect(priceTierFamily('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('claude-sonnet-4-5');
  });

  it('every row is ascending with a positive boundary', () => {
    for (const tiers of Object.values(PRICE_TIERS)) {
      expect(tiers.length).toBeGreaterThan(0);
      tiers.forEach((t, i) => {
        expect(t.aboveInputTokens).toBeGreaterThan(0);
        if (i > 0) expect(t.aboveInputTokens).toBeGreaterThan(tiers[i - 1]!.aboveInputTokens);
      });
    }
  });
});

describe('priceTierBoundary', () => {
  it('returns the lowest boundary, or undefined for a flat model', () => {
    expect(priceTierBoundary('googleai/gemini-2.5-pro')).toBe(200_000);
    expect(priceTierBoundary('claude-haiku-5-5')).toBe(100_000);
    expect(priceTierBoundary('claude-opus-5-5')).toBeUndefined();
    expect(priceTierBoundary(undefined)).toBeUndefined();
  });
});

describe('tier-aware cost', () => {
  const gemini: ModelPrice = withPriceTiers('gemini-2.5-pro', { input: M(1.25), output: M(10) });

  it('a flat price is unchanged by the tier logic', () => {
    const flat: ModelPrice = { input: M(1), output: M(2) };
    expect(withPriceTiers('claude-opus-5-5', flat)).toBe(flat);
    expect(estimateCostUsd(flat, 300_000, 1_000)).toBeCloseTo(0.3 + 0.002);
    expect(lowestTierBoundary(flat)).toBeUndefined();
  });

  it('above the boundary the whole request bills at the tier rate', () => {
    expect(lowestTierBoundary(gemini)).toBe(200_000);
    expect(estimateCostUsd(gemini, 100_000, 1_000)).toBeCloseTo(0.125 + 0.01);
    expect(estimateCostUsd(gemini, 300_000, 1_000)).toBeCloseTo(0.75 + 0.015);
    expect(rateForInput(gemini, 200_000)).toEqual({ input: M(1.25), output: M(10), priceTiers: gemini.priceTiers });
  });
});
