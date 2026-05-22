import { describe, expect, it } from 'vitest';
import { composeFreeCappedCascade } from './cascadeComposer';

// ---------------------------------------------------------------------------
// composeFreeCappedCascade — shared helper for the 2-free-then-premium chain.
// Both LlmProxyService and ImageProxyService call this; tests live here so a
// single-surface bug can't drift between them.
// ---------------------------------------------------------------------------

describe('composeFreeCappedCascade', () => {
  const tierMap = (entries: Record<string, 'FREE' | 'PREMIUM'>) =>
    (m: string) => entries[m] ?? 'PREMIUM';

  it('caps FREE-tier entries at the budget and appends the premium fallback', () => {
    const chain = composeFreeCappedCascade({
      seed: ['free-a', 'free-b', 'free-c', 'free-d'],
      premiumFallback: ['premium-x'],
      freeBudget: 2,
      tierOf: tierMap({ 'free-a': 'FREE', 'free-b': 'FREE', 'free-c': 'FREE', 'free-d': 'FREE' }),
      isUnavailable: () => false,
      cursor: { value: 0 },
    });
    expect(chain).toEqual(['free-a', 'free-b', 'premium-x']);
  });

  it('keeps paid models verbatim alongside the FREE cap (Pro plan shape)', () => {
    const chain = composeFreeCappedCascade({
      seed: ['free-a', 'free-b', 'free-c', 'paid-1', 'paid-2'],
      premiumFallback: ['premium-x'],
      freeBudget: 2,
      tierOf: tierMap({ 'free-a': 'FREE', 'free-b': 'FREE', 'free-c': 'FREE' }),
      isUnavailable: () => false,
      cursor: { value: 0 },
    });
    expect(chain).toEqual(['free-a', 'free-b', 'paid-1', 'paid-2', 'premium-x']);
  });

  it('round-robins within the FREE slice across calls', () => {
    const cursor = { value: 0 };
    const seed   = ['free-a', 'free-b'];
    const tier   = tierMap({ 'free-a': 'FREE', 'free-b': 'FREE' });
    const opts = {
      seed, premiumFallback: ['premium-x'] as readonly string[],
      freeBudget: 2, tierOf: tier, isUnavailable: () => false, cursor,
    };
    expect(composeFreeCappedCascade(opts)).toEqual(['free-a', 'free-b', 'premium-x']);
    expect(composeFreeCappedCascade(opts)).toEqual(['free-b', 'free-a', 'premium-x']);
  });

  it('skips unavailable models without consuming the FREE budget', () => {
    const chain = composeFreeCappedCascade({
      seed: ['free-a', 'free-b', 'free-c'],
      premiumFallback: ['premium-x'],
      freeBudget: 2,
      tierOf: tierMap({ 'free-a': 'FREE', 'free-b': 'FREE', 'free-c': 'FREE' }),
      // free-a is cooled — should be skipped, free-b and free-c fill the budget
      isUnavailable: (m) => m === 'free-a',
      cursor: { value: 0 },
    });
    expect(chain).toEqual(['free-b', 'free-c', 'premium-x']);
  });

  it('drops cooled premium fallback entries', () => {
    const chain = composeFreeCappedCascade({
      seed: ['free-a'],
      premiumFallback: ['premium-x', 'premium-y'],
      freeBudget: 2,
      tierOf: tierMap({ 'free-a': 'FREE' }),
      isUnavailable: (m) => m === 'premium-x',
      cursor: { value: 0 },
    });
    expect(chain).toEqual(['free-a', 'premium-y']);
  });

  it('dedups entries that appear in both seed and premium fallback', () => {
    const chain = composeFreeCappedCascade({
      seed: ['free-a', 'premium-x'],   // caller-pinned the premium model
      premiumFallback: ['premium-x'],
      freeBudget: 2,
      tierOf: tierMap({ 'free-a': 'FREE' }),
      isUnavailable: () => false,
      cursor: { value: 0 },
    });
    // 'premium-x' appears once (preserved in seed position, dropped from fallback)
    expect(chain).toEqual(['free-a', 'premium-x']);
  });

  it('returns empty array when every candidate is unavailable', () => {
    const chain = composeFreeCappedCascade({
      seed: ['free-a', 'free-b'],
      premiumFallback: ['premium-x'],
      freeBudget: 2,
      tierOf: tierMap({ 'free-a': 'FREE', 'free-b': 'FREE' }),
      isUnavailable: () => true,
      cursor: { value: 0 },
    });
    expect(chain).toEqual([]);
  });

  it('increments cursor exactly once per call regardless of FREE slice size', () => {
    const cursor = { value: 5 };
    composeFreeCappedCascade({
      seed: ['free-a', 'free-b', 'paid-1'],
      premiumFallback: [],
      freeBudget: 2,
      tierOf: tierMap({ 'free-a': 'FREE', 'free-b': 'FREE' }),
      isUnavailable: () => false,
      cursor,
    });
    expect(cursor.value).toBe(6);
  });
});
