/**
 * The "one zone-ranking rule" guardrail: QaHeatmapService adds no ordering of its own,
 * its zones are exactly `rankHeatZones` (domain/qa/heatZones.ts) over the same rows —
 * the rule session-replay Insights ranks by too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rankHeatZones } from '../../domain/qa/heatZones';
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
  it('returns zones byte-identical to rankHeatZones over the same rows', async () => {
    const limit = 4;
    const zones = await new QaHeatmapService(fakeDb()).rankZones(7, { limit });

    // The same rows the service builds (routes first, then elements), ranked by THE rule.
    const rows = [
      ...ROUTES.filter((r) => r.route).map((r) => ({
        route: r.route as string, selector: null as string | null, kind: 'pageview', label: null as string | null,
        count: r.heat, lastSeen: new Date(r.lastTs),
      })),
      ...ELEMENTS.map((e) => ({
        route: e.route ?? '/', selector: e.selector as string | null, kind: e.kind, label: e.label as string | null,
        count: e.heat, lastSeen: new Date(e.lastTs),
      })),
    ];
    const expected = rankHeatZones(rows, NOW, limit).map(({ count, lastSeen: _lastSeen, ...zone }) => ({ ...zone, heat: count }));

    expect(JSON.stringify(zones)).toBe(JSON.stringify(expected));
    expect(zones).toHaveLength(limit);
    // Recency really weighs in: the 400-click control last touched 60 days ago ranks below a fresher, less-clicked page.
    expect(zones.findIndex((z) => z.selector === '#pay')).toBeGreaterThan(zones.findIndex((z) => z.route === '/pricing' && z.selector === null));
  });
});
