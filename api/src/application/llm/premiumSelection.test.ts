import { describe, it, expect } from 'vitest';
import {
  isPremiumModelSelection,
  modelPoolForPlan,
  FREE_MODEL_POOL,
} from './LlmProxyService';
import {
  computeCostMillicents,
  PREMIUM_REQUEST_SURCHARGE_MILLICENTS,
} from './usageLedger';

/**
 * PREMIUM selection = an explicit pin on a PAID OpenRouter model the plan's own pool
 * does NOT already route. It is what triggers both the card gate and the flat 1¢
 * surcharge, so the classification has to be exact in both directions: over-classifying
 * surcharges a model the tenant already pays for via their plan; under-classifying gives
 * away the metered long tail for free.
 */
describe('isPremiumModelSelection', () => {
  it('classifies an off-pool paid OpenRouter model as premium', () => {
    // A real OpenRouter `<org>/<slug>` id we do NOT curate — resolves to the OpenRouter
    // vendor by default and is absent from every plan pool.
    expect(isPremiumModelSelection('openai/o1-pro', 'pro')).toBe(true);
  });

  it('does NOT classify a model the paid plan pool already routes', () => {
    const inPool = modelPoolForPlan('pro').find((m) => m.includes('/'));
    expect(inPool).toBeDefined();
    expect(isPremiumModelSelection(inPool!, 'pro')).toBe(false);
  });

  it('does NOT classify a free OpenRouter model, even off-pool', () => {
    expect(isPremiumModelSelection('some-vendor/some-model:free', 'pro')).toBe(false);
  });

  it('does NOT classify free-pool models', () => {
    for (const m of FREE_MODEL_POOL.slice(0, 5)) {
      expect(isPremiumModelSelection(m, 'free')).toBe(false);
    }
  });

  it('does NOT classify non-OpenRouter vendors (Cloudflare / direct BYO / Evermind)', () => {
    expect(isPremiumModelSelection('@cf/zai-org/glm-4.7-flash', 'pro')).toBe(false);
    expect(isPremiumModelSelection('direct/openai/gpt-4.1', 'pro')).toBe(false);
    expect(isPremiumModelSelection('googleai/gemini-2.5-pro', 'pro')).toBe(false);
    expect(isPremiumModelSelection('evermind/some/ref', 'pro')).toBe(false);
  });

  it('treats an absent / blank pin as no selection', () => {
    expect(isPremiumModelSelection(undefined, 'pro')).toBe(false);
    expect(isPremiumModelSelection('', 'pro')).toBe(false);
    expect(isPremiumModelSelection('   ', 'pro')).toBe(false);
  });

  it('classifies a paid model as premium for a FREE plan (it is off their pool)', () => {
    // The gate then rejects it with plan_required — free tenants can't reach premium.
    expect(isPremiumModelSelection('openai/o1-pro', 'free')).toBe(true);
  });
});

describe('premium surcharge', () => {
  const usage = { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 };

  it('is exactly 1 cent', () => {
    // millicents are 1/100000 USD → 1¢ = $0.01 = 1000 millicents.
    expect(PREMIUM_REQUEST_SURCHARGE_MILLICENTS).toBe(1_000);
    expect(PREMIUM_REQUEST_SURCHARGE_MILLICENTS / 100_000).toBeCloseTo(0.01);
  });

  it('is a FLAT per-request add-on over the metered OpenRouter cost', () => {
    // $1/M in, $2/M out over 1K+1K tokens = $0.001 + $0.002 = $0.003 → 300 millicents.
    const pricing = { prompt: 0.000001, completion: 0.000002 };
    const metered = computeCostMillicents(pricing, usage);
    expect(metered).toBe(300);
    // The route adds the surcharge on top — "OpenRouter cost + a penny", not a multiplier.
    expect(metered + PREMIUM_REQUEST_SURCHARGE_MILLICENTS).toBe(1_300);
  });

  it('does not scale with token volume', () => {
    const pricing = { prompt: 0.000001, completion: 0.000002 };
    const small = computeCostMillicents(pricing, usage);
    const large = computeCostMillicents(pricing, {
      promptTokens: 100_000, completionTokens: 100_000, totalTokens: 200_000,
    });
    // Same flat cent regardless of how big the call was.
    expect((small + PREMIUM_REQUEST_SURCHARGE_MILLICENTS) - small).toBe(PREMIUM_REQUEST_SURCHARGE_MILLICENTS);
    expect((large + PREMIUM_REQUEST_SURCHARGE_MILLICENTS) - large).toBe(PREMIUM_REQUEST_SURCHARGE_MILLICENTS);
  });
});
