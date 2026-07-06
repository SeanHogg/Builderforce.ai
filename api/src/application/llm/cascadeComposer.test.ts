import { describe, expect, it } from 'vitest';
import { composeFreeCappedCascade, buildCooldownPredicate } from './cascadeComposer';

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

  it('leads with the HEAD (connected-BYO flagship) BEFORE the free slice — the buried-account bug', () => {
    // Regression for the production symptom: a connected Claude subscription seeded
    // `claude-opus-4-8` (PREMIUM), but the composer put all FREE models first, so the
    // account was tried LAST (or never) and the run "produced no reply" on an @cf/* coder.
    // With `head`, the deliberately-seeded flagship must lead verbatim.
    const chain = composeFreeCappedCascade({
      head: ['claude-opus-4-8'],
      seed: ['claude-opus-4-8', 'free-a', 'free-b', 'free-c'], // seed still contains the head
      premiumFallback: ['premium-x'],
      freeBudget: 2,
      tierOf: tierMap({ 'free-a': 'FREE', 'free-b': 'FREE', 'free-c': 'FREE' }), // claude-* defaults PREMIUM
      isUnavailable: () => false,
      cursor: { value: 0 },
    });
    // Connected account FIRST, then the (capped) free slice, then premium fallback.
    expect(chain).toEqual(['claude-opus-4-8', 'free-a', 'free-b', 'premium-x']);
    expect(chain[0]).toBe('claude-opus-4-8');
  });

  it('drops a HEAD entry that is unavailable (cooled) rather than forcing a known-broken model', () => {
    const chain = composeFreeCappedCascade({
      head: ['claude-opus-4-8'],
      seed: ['claude-opus-4-8', 'free-a'],
      premiumFallback: [],
      freeBudget: 2,
      tierOf: tierMap({ 'free-a': 'FREE' }),
      isUnavailable: (m) => m === 'claude-opus-4-8', // connected flagship on cooldown this moment
      cursor: { value: 0 },
    });
    expect(chain).toEqual(['free-a']);
  });

  it('with no head, behaviour is unchanged (paid seed still trails the free slice)', () => {
    const chain = composeFreeCappedCascade({
      seed: ['paid-1', 'free-a', 'free-b'],
      premiumFallback: [],
      freeBudget: 2,
      tierOf: tierMap({ 'free-a': 'FREE', 'free-b': 'FREE' }), // paid-1 defaults PREMIUM
      isUnavailable: () => false,
      cursor: { value: 0 },
    });
    // No head passed → the legacy "free first, paid trails" ordering is preserved.
    expect(chain).toEqual(['free-a', 'free-b', 'paid-1']);
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

  it('respects per-model cooldown even for the pinned hint (composer integration)', () => {
    // Regression for the "paid failover not working" production trace: caller
    // pins anthropic/claude-3-haiku, vendor cooldown is hot on openrouter,
    // pool has nvidia models with bad ids. Pinned model must still be tried.
    const vendorOf = (m: string) => m.startsWith('nvidia/') ? 'nvidia' : 'openrouter';
    const isUnavailable = buildCooldownPredicate({
      cooledModels:  new Set<string>(),                  // no per-model cooldown
      cooledVendors: new Set<string>(['openrouter']),    // openrouter cooled by free 429s
      vendorOf,
      pinnedModel:   'anthropic/claude-3-haiku',
    });
    const chain = composeFreeCappedCascade({
      seed: ['anthropic/claude-3-haiku', 'qwen/qwen3-coder:free', 'nvidia/some-paid-model'],
      premiumFallback: [],
      freeBudget: 2,
      tierOf: tierMap({ 'qwen/qwen3-coder:free': 'FREE' }),
      isUnavailable,
      cursor: { value: 0 },
    });
    // Pinned anthropic model is kept (vendor cooldown bypassed for it).
    // qwen is dropped (openrouter cooled, not pinned). nvidia paid is kept.
    expect(chain).toEqual(['anthropic/claude-3-haiku', 'nvidia/some-paid-model']);
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

describe('buildCooldownPredicate', () => {
  const vendorOf = (m: string) => m.split('/')[0]!;

  it('filters models on per-model cooldown', () => {
    const isUnavail = buildCooldownPredicate({
      cooledModels:  new Set(['openrouter/qwen/qwen3-coder:free']),
      cooledVendors: new Set(),
      vendorOf:      (_m) => 'openrouter',  // all openrouter-vended in this test
    });
    expect(isUnavail('qwen/qwen3-coder:free')).toBe(true);
    expect(isUnavail('anthropic/claude-3-haiku')).toBe(false);
  });

  it('filters models on per-vendor cooldown by default', () => {
    const isUnavail = buildCooldownPredicate({
      cooledModels:  new Set(),
      cooledVendors: new Set(['openrouter']),
      vendorOf:      (_m) => 'openrouter',
    });
    expect(isUnavail('anthropic/claude-3-haiku')).toBe(true);
    expect(isUnavail('qwen/qwen3-coder:free')).toBe(true);
  });

  it('bypasses per-vendor cooldown for the caller-pinned model', () => {
    // The headline behaviour: caller pinned a paid model, the vendor is cooled
    // because its free key 429'd, but the pinned model still gets through.
    const isUnavail = buildCooldownPredicate({
      cooledModels:  new Set(),
      cooledVendors: new Set(['openrouter']),
      vendorOf:      (_m) => 'openrouter',
      pinnedModel:   'anthropic/claude-3-haiku',
    });
    expect(isUnavail('anthropic/claude-3-haiku')).toBe(false);  // pinned → pass
    expect(isUnavail('qwen/qwen3-coder:free')).toBe(true);      // not pinned → still vendor-cooled
  });

  it('still respects per-model cooldown on the pinned hint', () => {
    // Per-model cooldown is sticky even for the pinned slot — we don't retry
    // a model that itself just failed N seconds ago. In production
    // `anthropic/claude-3-haiku` resolves to vendor `openrouter` via catalog
    // lookup, so the cooldown key is `openrouter/anthropic/claude-3-haiku`.
    const isUnavail = buildCooldownPredicate({
      cooledModels:  new Set(['openrouter/anthropic/claude-3-haiku']),
      cooledVendors: new Set(),
      vendorOf:      (_m) => 'openrouter',
      pinnedModel:   'anthropic/claude-3-haiku',
    });
    expect(isUnavail('anthropic/claude-3-haiku')).toBe(true);
  });
});
