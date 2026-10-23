import { describe, expect, it } from 'vitest';
import { BATCH_PRICE_MULTIPLIER, computeCostMillicents, pricingForTier } from './usageLedger';

const pricing = { prompt: 0.000003, completion: 0.000015 };
const usage = { promptTokens: 10_000, completionTokens: 1_000, totalTokens: 11_000, cacheReadTokens: 4_000 };

describe('pricingForTier', () => {
  it('leaves standard (and unset) calls at the catalog price', () => {
    expect(pricingForTier(pricing, 'standard')).toBe(pricing);
    expect(pricingForTier(pricing, null)).toBe(pricing);
    expect(pricingForTier(undefined, 'batch')).toBeUndefined();
  });

  it('halves every token tier for a batch-API call', () => {
    const standard = computeCostMillicents(pricing, usage);
    const batch = computeCostMillicents(pricingForTier(pricing, 'batch'), usage);
    expect(BATCH_PRICE_MULTIPLIER).toBe(0.5);
    expect(batch).toBe(Math.round(standard * BATCH_PRICE_MULTIPLIER));
  });
});
