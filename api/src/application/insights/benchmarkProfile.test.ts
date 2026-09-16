import { describe, expect, it, vi } from 'vitest';
import {
  BenchmarkProfileError,
  assertKnownCohort,
  benchmarkProfileCacheKey,
  benchmarkVersionKey,
  resolveBenchmarkProfilePatch,
} from './benchmarkProfile';
import { rankPercentile } from './benchmarkingInsights';

/**
 * The ONE writer of `tenant_benchmark_profiles` (PRD 25 §6.4), plus the ranking
 * function every vertical dashboard's peer tile reads through.
 *
 * Two properties matter here and neither is obvious from the code:
 *
 *  1. A BLANK field keeps its current value. The patch arrives from a form, and a
 *     form submits every field it renders — so an untouched size band arrives as
 *     `''`, not as `undefined`. Treating blank as "set it to blank" would let a
 *     manager who edited only the industry silently wipe their cohort's size band.
 *  2. The percentile FLIPS for metrics where lower is better. Lead time, MTTR and
 *     burn are all "lower is better", and they are exactly the metrics a founder
 *     dashboard shows. Getting the direction wrong would tell a company with the
 *     best runway discipline in its cohort that it is in the bottom decile.
 */

const CURRENT = { industry: 'saas', sizeBand: 'mid' };

/**
 * `resolveBenchmarkProfilePatch` reads the current profile through
 * `getBenchmarkProfile`, which is a database read. The patch logic under test is
 * pure, so the read is stubbed rather than stood up.
 */
vi.mock('./benchmarkingInsights', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./benchmarkingInsights')>();
  return {
    ...actual,
    getBenchmarkProfile: vi.fn(async () => ({ ...CURRENT })),
    listBenchmarkCohorts: vi.fn(async () => ({
      industries: ['saas', 'fintech', 'healthtech'],
      sizeBands: ['small', 'mid', 'large'],
    })),
  };
});

const db = {} as never;

describe('resolveBenchmarkProfilePatch', () => {
  it('applies both fields when both are given', async () => {
    const next = await resolveBenchmarkProfilePatch(db, 1, { industry: 'fintech', sizeBand: 'large' });
    expect(next).toEqual({ industry: 'fintech', sizeBand: 'large' });
  });

  it('keeps the current value for a blank, whitespace or missing field', async () => {
    // The regression this guards: a form posting an untouched field as ''.
    for (const patch of [{ industry: '' }, { industry: '   ' }, {}] as const) {
      expect(await resolveBenchmarkProfilePatch(db, 1, patch)).toEqual(CURRENT);
    }
    expect(await resolveBenchmarkProfilePatch(db, 1, { sizeBand: '' })).toEqual(CURRENT);
  });

  it('keeps the current value for a null field', async () => {
    expect(await resolveBenchmarkProfilePatch(db, 1, { industry: null, sizeBand: null })).toEqual(CURRENT);
  });

  it('trims surrounding whitespace', async () => {
    const next = await resolveBenchmarkProfilePatch(db, 1, { industry: '  fintech  ', sizeBand: ' large ' });
    expect(next).toEqual({ industry: 'fintech', sizeBand: 'large' });
  });

  it('bounds the stored length so a pasted essay cannot become a cohort key', async () => {
    const next = await resolveBenchmarkProfilePatch(db, 1, {
      industry: 'x'.repeat(200),
      sizeBand: 'y'.repeat(200),
    });
    expect(next.industry).toHaveLength(48);
    expect(next.sizeBand).toHaveLength(16);
  });
});

describe('assertKnownCohort', () => {
  it('accepts a seeded cohort', async () => {
    await expect(assertKnownCohort(db, { industry: 'saas', sizeBand: 'mid' })).resolves.toBeUndefined();
  });

  it('refuses an unseeded industry, and names the options', async () => {
    // The refusal carries the valid list because the caller renders it as the
    // picker's choices — an error saying only "invalid" leaves a dead end.
    const err = await assertKnownCohort(db, { industry: 'nope', sizeBand: 'mid' }).catch((e) => e);
    expect(err).toBeInstanceOf(BenchmarkProfileError);
    expect(err.status).toBe(400);
    expect(err.detail.industries).toContain('saas');
  });

  it('refuses an unseeded size band, and names the options', async () => {
    const err = await assertKnownCohort(db, { industry: 'saas', sizeBand: 'enormous' }).catch((e) => e);
    expect(err).toBeInstanceOf(BenchmarkProfileError);
    expect(err.detail.sizeBands).toContain('mid');
  });
});

describe('cache keys', () => {
  it('scopes by tenant so one tenant cannot read another tenant ranking', () => {
    expect(benchmarkProfileCacheKey(7)).toContain(':7');
    expect(benchmarkProfileCacheKey(7)).not.toBe(benchmarkProfileCacheKey(8));
    expect(benchmarkVersionKey(7)).not.toBe(benchmarkVersionKey(8));
    // The version key must differ from the value key, or bumping the version
    // would overwrite the profile it is supposed to invalidate.
    expect(benchmarkVersionKey(7)).not.toBe(benchmarkProfileCacheKey(7));
  });
});

describe('rankPercentile', () => {
  const dist = { p10: 10, p25: 25, p50: 50, p75: 75, p90: 90 } as never;

  it('places a median value at the middle', () => {
    expect(rankPercentile(50, dist, true)).toBe(50);
  });

  it('flips direction when lower is better', () => {
    // Burn, lead time and MTTR are all lower-is-better, and they are precisely
    // the founder metrics this ranking is shown against.
    const high = rankPercentile(90, dist, true);
    const highFlipped = rankPercentile(90, dist, false);
    expect(high).toBeGreaterThan(50);
    expect(highFlipped).toBeLessThan(50);
    expect(high! + highFlipped!).toBe(100);
  });

  it('clamps the tails instead of running off the scale', () => {
    const below = rankPercentile(-1000, dist, true);
    const above = rankPercentile(1000, dist, true);
    expect(below).toBeGreaterThanOrEqual(0);
    expect(below).toBeLessThanOrEqual(10);
    expect(above).toBeGreaterThanOrEqual(90);
    expect(above).toBeLessThanOrEqual(100);
  });

  it('interpolates between adjacent anchors', () => {
    const mid = rankPercentile(62.5, dist, true);
    expect(mid).toBeGreaterThan(50);
    expect(mid).toBeLessThan(75);
  });

  it('returns null rather than a fake rank when there is nothing to rank', () => {
    // Null is "not measured". A zero here would read as "worst in cohort".
    expect(rankPercentile(null, dist, true)).toBeNull();
    expect(rankPercentile(undefined, dist, true)).toBeNull();
    expect(rankPercentile(Number.NaN, dist, true)).toBeNull();
    // A distribution with fewer than two usable anchors cannot be interpolated.
    expect(rankPercentile(50, { p10: null, p25: null, p50: 50, p75: null, p90: null } as never, true)).toBeNull();
  });
});
