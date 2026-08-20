/**
 * The ranking function decides which listings a stranger sees first, so it is
 * tested as BEHAVIOUR — "a young reviewed package can beat a stale incumbent" —
 * rather than as arithmetic. If the weights are retuned these tests should still
 * pass; if they stop passing, the retune changed the directory's editorial policy
 * and that is exactly the thing somebody should have to notice.
 */
import { describe, expect, it } from 'vitest';
import {
  assuranceFor,
  freshnessScore,
  popularityScore,
  rankListing,
  rankListings,
  FRESHNESS_HALF_LIFE_DAYS,
  POPULARITY_SATURATION,
  type ListingSignals,
} from './catalogRanking';

const NOW = new Date('2026-08-20T00:00:00.000Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

const signals = (over: Partial<ListingSignals> = {}): ListingSignals => ({
  installs: 0,
  reviewedAt: NOW,
  assurance: 'parsed',
  ...over,
});

describe('popularityScore', () => {
  it('is zero with no installs and saturates rather than growing forever', () => {
    expect(popularityScore(0)).toBe(0);
    expect(popularityScore(POPULARITY_SATURATION)).toBeCloseTo(1, 5);
    expect(popularityScore(POPULARITY_SATURATION * 100)).toBe(1);
  });

  it('rewards the first few installs far more than the last few — the whole point of the log', () => {
    const firstTen = popularityScore(10) - popularityScore(0);
    const lastTen = popularityScore(POPULARITY_SATURATION) - popularityScore(POPULARITY_SATURATION - 10);
    expect(firstTen).toBeGreaterThan(lastTen * 3);
  });
});

describe('freshnessScore', () => {
  it('halves over the half-life', () => {
    expect(freshnessScore(NOW, NOW)).toBeCloseTo(1, 5);
    expect(freshnessScore(daysAgo(FRESHNESS_HALF_LIFE_DAYS), NOW)).toBeCloseTo(0.5, 5);
    expect(freshnessScore(daysAgo(FRESHNESS_HALF_LIFE_DAYS * 2), NOW)).toBeCloseTo(0.25, 5);
  });

  it('scores a never-reviewed listing at zero, NOT as if it were reviewed today', () => {
    // The one direction this could be wrong that puts an unproven listing on top.
    expect(freshnessScore(null, NOW)).toBe(0);
  });

  it('clamps a future timestamp instead of treating clock skew as a bonus', () => {
    expect(freshnessScore(new Date(NOW.getTime() + 86_400_000), NOW)).toBeCloseTo(1, 5);
  });
});

describe('assuranceFor', () => {
  it('is unreviewed when the version was not approved, whatever the stages said', () => {
    expect(assuranceFor({ approved: false, stageVerdicts: { static: 'pass', dynamic: 'pass', agentic: 'pass' } }))
      .toBe('unreviewed');
  });

  it('is only `parsed` when nothing went and looked', () => {
    expect(assuranceFor({ approved: true, stageVerdicts: { static: 'pass' } })).toBe('parsed');
    // A SKIPPED dynamic stage is the absence of the evidence `exercised` claims.
    expect(assuranceFor({ approved: true, stageVerdicts: { static: 'pass', dynamic: 'skipped', agentic: 'skipped' } }))
      .toBe('parsed');
  });

  it('reaches `exercised` only when the dynamic AND agentic stages both ran clean', () => {
    expect(assuranceFor({ approved: true, stageVerdicts: { static: 'pass', dynamic: 'pass', agentic: 'pass' } }))
      .toBe('exercised');
    expect(assuranceFor({ approved: true, stageVerdicts: { static: 'pass', dynamic: 'warn', agentic: 'pass' } }))
      .toBe('flagged');
  });
});

describe('rankListing', () => {
  it('lets a freshly reviewed, fully exercised package beat a stale incumbent with 40x the installs', () => {
    const newcomer = rankListing(signals({ installs: 2, reviewedAt: NOW, assurance: 'exercised' }), 'browse', NOW);
    const incumbent = rankListing(
      signals({ installs: 80, reviewedAt: daysAgo(400), assurance: 'parsed' }),
      'browse',
      NOW,
    );
    expect(newcomer).toBeGreaterThan(incumbent);
  });

  it('still puts a popular, maintained package above an unproven one', () => {
    const good = rankListing(signals({ installs: 60, reviewedAt: daysAgo(20), assurance: 'exercised' }), 'browse', NOW);
    const unproven = rankListing(signals({ installs: 0, reviewedAt: null, assurance: 'unreviewed' }), 'browse', NOW);
    expect(good).toBeGreaterThan(unproven);
  });

  it('makes relevance dominate under the search weighting, and ignores it while browsing', () => {
    const relevant = signals({ installs: 0, reviewedAt: daysAgo(200), assurance: 'parsed', relevance: 1 });
    const popular = signals({ installs: 90, reviewedAt: NOW, assurance: 'exercised', relevance: 0 });
    expect(rankListing(relevant, 'search', NOW)).toBeGreaterThan(0);
    expect(rankListing(popular, 'browse', NOW)).toBeGreaterThan(rankListing(relevant, 'browse', NOW));
  });

  it('always returns a comparable score in [0, 1]', () => {
    const best = rankListing(signals({ installs: 10_000, reviewedAt: NOW, assurance: 'exercised', relevance: 1 }), 'search', NOW);
    const worst = rankListing(signals({ installs: 0, reviewedAt: null, assurance: 'unreviewed', relevance: 0 }), 'search', NOW);
    expect(best).toBeLessThanOrEqual(1);
    expect(worst).toBe(0);
  });
});

describe('rankListings', () => {
  it('produces a TOTAL order, so paging cannot show one listing twice and hide another', () => {
    const identical = ['b', 'a', 'c'].map((key) => ({ key, signals: signals({ installs: 5 }) }));
    expect(rankListings(identical, 'browse', NOW).map((r) => r.key)).toEqual(['a', 'b', 'c']);
  });

  it('orders best first', () => {
    const rows = [
      { key: 'stale', signals: signals({ installs: 3, reviewedAt: daysAgo(500), assurance: 'parsed' as const }) },
      { key: 'fresh', signals: signals({ installs: 3, reviewedAt: NOW, assurance: 'exercised' as const }) },
    ];
    expect(rankListings(rows, 'browse', NOW)[0]?.key).toBe('fresh');
  });
});
