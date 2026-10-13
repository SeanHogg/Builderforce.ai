/**
 * Which pages a review captures (PRD 33 §5.2): entry pages, funnel pages, proof pages,
 * then the top routes — concrete paths only, ≤ 25, cached under the site's version.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routes: vi.fn(),
  funnels: vi.fn(),
  getOrSetCached: vi.fn(async (_env: unknown, _key: string, load: () => Promise<unknown>) => load()),
  site: { id: 's1', tenantId: 7, kind: 'hosted', projectId: 42 } as Record<string, unknown>,
  proofRows: [] as Array<{ measure: unknown }>,
}));

vi.mock('./ReplayHeatmapService', () => ({
  ReplayHeatmapService: vi.fn(function ReplayHeatmapService() { return { routes: mocks.routes }; }),
}));
vi.mock('./ReplayFunnelService', () => ({
  ReplayFunnelService: vi.fn(function ReplayFunnelService() { return { list: mocks.funnels }; }),
}));
vi.mock('./replaySites', () => ({ getSiteForTenant: vi.fn(async () => mocks.site) }));
vi.mock('./replayCacheKeys', () => ({ replayReadKeys: vi.fn(async () => ({ pageSelection: () => 'k:page-selection' })) }));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({ getOrSetCached: mocks.getOrSetCached }));

import { isCapturablePath, PAGE_REVIEW_MAX_PAGES, pagesToReview, proofPathsOf, selectPages } from './pageSelection';

const route = (path: string, sessions: number, pageviews: number) => ({ route: path, sessions, pageviews });
const funnel = (steps: Array<{ stepKind: string; match: string; matchMode: string }>) => ({
  id: 'f1', name: 'Checkout', windowMinutes: 30, steps: steps.map((s, i) => ({ ord: i, label: s.match, ...s })),
});

describe('selectPages', () => {
  it('orders entry pages, funnel pages, proof pages, then top routes, deduped', () => {
    const pages = selectPages({
      routes: [route('/', 900, 2_000), route('/blog', 50, 3_000), route('/pricing', 300, 1_000), route('/docs', 0, 500)],
      funnels: [funnel([
        { stepKind: 'page', match: '/pricing', matchMode: 'equals' },
        { stepKind: 'page', match: '/checkout', matchMode: 'prefix' },
        { stepKind: 'click', match: 'button.pay', matchMode: 'equals' },
        { stepKind: 'page', match: 'thank', matchMode: 'contains' },
      ]) as never],
      proofPaths: ['/signup'],
    });
    expect(pages).toEqual(['/', '/pricing', '/blog', '/checkout', '/signup', '/docs']);
  });

  it('never selects a route template or a pattern, and stops at 25', () => {
    expect(isCapturablePath('/product/:id')).toBe(false);
    expect(isCapturablePath('//evil.example')).toBe(false);
    expect(isCapturablePath('/a b')).toBe(false);
    expect(isCapturablePath('/pricing')).toBe(true);
    const many = Array.from({ length: 60 }, (_, i) => route(`/p${i}`, i, 1_000 - i));
    const pages = selectPages({ routes: [route('/product/:id', 10_000, 10_000), ...many], funnels: [], proofPaths: Array.from({ length: 30 }, (_, i) => `/proof${i}`) });
    expect(pages).toHaveLength(PAGE_REVIEW_MAX_PAGES);
    expect(pages).not.toContain('/product/:id');
  });
});

describe('proofPathsOf', () => {
  it('reads the path clauses of each measured proof', () => {
    expect(proofPathsOf([
      { sample: { filter: { all: [{ field: 'entryPath', op: 'eq', value: '/launch' }, { field: 'device', op: 'eq', value: 'phone' }] }, min: 100 } },
      { sample: { filter: { all: [{ field: 'visitedPath', op: 'in', value: ['/a', '/b'] }] } } },
      null,
    ])).toEqual(['/launch', '/a', '/b']);
  });
});

describe('pagesToReview', () => {
  beforeEach(() => {
    mocks.routes.mockResolvedValue([route('/', 10, 20)]);
    mocks.funnels.mockResolvedValue([]);
    mocks.getOrSetCached.mockClear();
  });

  it('reads through the site-versioned cache and includes the project\'s proof pages', async () => {
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ measure: { sample: { filter: { all: [{ field: 'entryPath', op: 'eq', value: '/proof' }] } } } }] }) }) }),
    };
    const pages = await pagesToReview({} as never, db as never, { tenantId: 7, siteId: 's1' });
    expect(pages).toEqual(['/', '/proof']);
    expect(mocks.getOrSetCached.mock.calls[0]![1]).toBe('k:page-selection');
  });
});
