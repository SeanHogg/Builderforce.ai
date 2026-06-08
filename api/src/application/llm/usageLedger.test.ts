import { describe, expect, it } from 'vitest';
import { computeCostMillicents } from './usageLedger';

describe('computeCostMillicents', () => {
  // $1/1M input ($1e-6/token), $2/1M output ($2e-6/token).
  const pricing = { prompt: 1e-6, completion: 2e-6 };

  it('prices plain prompt + completion tokens (millicents)', () => {
    // 1000 in * 1e-6 = $0.001; 500 out * 2e-6 = $0.001; total $0.002 = 200 mc.
    expect(computeCostMillicents(pricing, { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 })).toBe(200);
  });

  it('applies the cache-read (0.1x) and cache-creation (1.25x) discounts', () => {
    // promptTokens=1000 = 200 full + 600 cacheRead + 200 cacheCreation.
    // full:   200 * 1e-6            = 0.0002
    // read:   600 * 1e-6 * 0.1      = 0.00006
    // create: 200 * 1e-6 * 1.25     = 0.00025
    // out:    100 * 2e-6            = 0.0002
    // total = 0.00071 USD = 71 millicents.
    const cost = computeCostMillicents(pricing, {
      promptTokens: 1000, completionTokens: 100, totalTokens: 1100,
      cacheReadTokens: 600, cacheCreationTokens: 200,
    });
    expect(cost).toBe(71);
  });

  it('returns 0 when the model has no catalog pricing', () => {
    expect(computeCostMillicents(undefined, { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 })).toBe(0);
  });

  it('never goes negative when cache tokens exceed the prompt count', () => {
    // Defensive: cacheRead+cacheCreation > promptTokens → full prompt floors at 0.
    const cost = computeCostMillicents(pricing, {
      promptTokens: 100, completionTokens: 0, totalTokens: 100,
      cacheReadTokens: 80, cacheCreationTokens: 80,
    });
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});
