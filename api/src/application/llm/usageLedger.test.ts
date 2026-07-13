import { describe, expect, it } from 'vitest';
import {
  computeCostMillicents,
  clampTokenCount,
  sanitizeUsage,
  resolvePaidOverflowCapMillicents,
  DEFAULT_PAID_OVERFLOW_CAP_MILLICENTS,
} from './usageLedger';

describe('resolvePaidOverflowCapMillicents', () => {
  it('uses the $0.50 default for a free tenant with no override', () => {
    expect(resolvePaidOverflowCapMillicents(null, 'free')).toBe(DEFAULT_PAID_OVERFLOW_CAP_MILLICENTS);
    expect(DEFAULT_PAID_OVERFLOW_CAP_MILLICENTS).toBe(50_000); // $0.50
  });

  it('treats paid plans (pro/teams) as unlimited when no override is set', () => {
    expect(resolvePaidOverflowCapMillicents(null, 'pro')).toBe(-1);
    expect(resolvePaidOverflowCapMillicents(null, 'teams')).toBe(-1);
  });

  it('honours an explicit -1 (unlimited) on any plan', () => {
    expect(resolvePaidOverflowCapMillicents(-1, 'free')).toBe(-1);
  });

  it('honours an explicit non-negative override over the plan default', () => {
    expect(resolvePaidOverflowCapMillicents(0, 'free')).toBe(0);
    expect(resolvePaidOverflowCapMillicents(250_000, 'pro')).toBe(250_000);
  });
});

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

describe('clampTokenCount — bad token values never reach the ledger', () => {
  it('passes a clean non-negative integer through unchanged', () => {
    expect(clampTokenCount(0)).toBe(0);
    expect(clampTokenCount(1500)).toBe(1500);
  });

  it('floors NaN / Infinity / -Infinity / null / undefined to 0 (would poison SUM())', () => {
    expect(clampTokenCount(Number.NaN)).toBe(0);
    expect(clampTokenCount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampTokenCount(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(clampTokenCount(null)).toBe(0);
    expect(clampTokenCount(undefined)).toBe(0);
  });

  it('clamps a negative to 0 and truncates a fractional count to an integer', () => {
    expect(clampTokenCount(-3)).toBe(0);
    expect(clampTokenCount(12.9)).toBe(12);
  });
});

describe('sanitizeUsage — every token field is clamped, cache-absence preserved', () => {
  it('clamps the required fields and keeps a clean record intact', () => {
    expect(sanitizeUsage({ promptTokens: 100, completionTokens: 50, totalTokens: 150 })).toEqual({
      promptTokens: 100, completionTokens: 50, totalTokens: 150,
    });
  });

  it('replaces NaN/negative token fields with 0', () => {
    expect(
      sanitizeUsage({ promptTokens: Number.NaN, completionTokens: -10, totalTokens: Number.POSITIVE_INFINITY }),
    ).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('does NOT invent cache fields when absent, but clamps them when present', () => {
    // absent → stays absent (an upstream with no cache breakdown is not recorded as explicit 0)
    expect(sanitizeUsage({ promptTokens: 1, completionTokens: 1, totalTokens: 2 })).not.toHaveProperty('cacheReadTokens');
    // present-but-bad → clamped to a number
    expect(
      sanitizeUsage({ promptTokens: 1, completionTokens: 1, totalTokens: 2, cacheReadTokens: Number.NaN, cacheCreationTokens: -5 }),
    ).toMatchObject({ cacheReadTokens: 0, cacheCreationTokens: 0 });
  });
});
