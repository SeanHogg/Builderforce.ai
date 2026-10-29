/**
 * The zone ranking QaHeatmapService serves — `count × 0.97^ageDays` (domain/qa/heatZones.ts,
 * the rule session-replay Insights ranks by too) — pinned to literal expected orders for a
 * fixed fixture, so a change to the rule cannot pass by re-running itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QaHeatmapService } from './QaHeatmapService';

const NOW = new Date('2026-10-12T10:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

const ELEMENTS = [
  { route: '/checkout', selector: '#pay', kind: 'click', label: 'Pay', heat: 400, lastTs: daysAgo(60).toISOString() },
  { route: '/pricing', selector: '.plan', kind: 'click', label: null, heat: 150, lastTs: daysAgo(1).toISOString() },
  { route: null, selector: '#menu', kind: 'click', label: 'Menu', heat: 90, lastTs: daysAgo(3) },
];
const ROUTES = [
  { route: '/pricing', heat: 300, lastTs: daysAgo(0).toISOString() },
  { route: '/checkout', heat: 120, lastTs: daysAgo(30).toISOString() },
  { route: null, heat: 999, lastTs: daysAgo(0).toISOString() },
];

/** Answers the element-level aggregation first, then the route-level one (the service's call order). */
function fakeDb() {
  const answers = [ELEMENTS, ROUTES];
  const chain: Record<string, unknown> = {
    from: () => chain, where: () => chain, groupBy: () => chain, orderBy: () => chain,
    limit: async () => answers.shift() ?? [],
  };
  return { select: () => chain } as never;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('QaHeatmapService.rankZones', () => {
  /*
   * Scores = count × 0.97^ageDays at NOW (pageviews are routes with a null selector; the
   * null-route row is dropped; the null-route element lands on "/"):
   *   /pricing page  300 × 0.97^0   = 300.0
   *   .plan          150 × 0.97^1   = 145.5
   *   #menu           90 × 0.97^3   ≈  82.1
   *   #pay           400 × 0.97^60  ≈  64.3   (400 clicks, but 60 days stale)
   *   /checkout page 120 × 0.97^30  ≈  48.1
   */
  const ranked = ['/pricing|null', '/pricing|.plan', '/|#menu', '/checkout|#pay', '/checkout|null'];
  const idOf = (zone: { route: string; selector: string | null }) => `${zone.route}|${zone.selector}`;

  it('ranks by recency-weighted heat, so a stale 400-click control sits below fresher, less-clicked zones', async () => {
    const zones = await new QaHeatmapService(fakeDb()).rankZones(7, { limit: 5 });
    expect(zones.map(idOf)).toEqual(ranked);
  });

  it('keeps only the top `limit` of that order', async () => {
    const zones = await new QaHeatmapService(fakeDb()).rankZones(7, { limit: 3 });
    expect(zones.map(idOf)).toEqual(ranked.slice(0, 3));
  });
});
