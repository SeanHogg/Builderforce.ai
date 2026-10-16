/**
 * `/api/replay/heatmap/*` — the Insights gate, the D17 `?site=` scope (one 403 for
 * a foreign or unknown site) and the query hand-off to the heatmap service. Auth is a
 * header-driven stand-in; `requireFeature` is the real gate over a mocked verdict;
 * the service and the site lookup are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The gate's proof-site clause: no workspace here reads its own live proof site.
vi.mock('../../application/replay/proofSiteRead', () => ({ readsOwnProofSite: async () => false }));
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { ForbiddenError } from '../../domain/shared/errors';

const OWN_SITE = '11111111-2222-4333-8444-555555555555';
const OTHER_SITE = '99999999-2222-4333-8444-555555555555';

const mocks = vi.hoisted(() => ({
  entitled: true,
  heat: {
    grid: vi.fn(),
    elements: vi.fn(),
    scrollDepth: vi.fn(),
    routes: vi.fn(),
    insights: vi.fn(),
    snapshot: vi.fn(),
  },
  getSiteForTenant: vi.fn(),
}));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/authMiddleware')>();
  const fakeAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    c.set('tenantId', Number(c.req.header('x-tenant') ?? 7));
    c.set('userId', 'u1');
    c.set('db', {} as never);
    await next();
  };
  return { ...real, authMiddleware: fakeAuth };
});
vi.mock('../../application/tenant/featureEntitlements', () => ({
  resolveFeatureEntitlement: vi.fn(async (_env: unknown, _tenantId: number, _userId: unknown, feature: string) => ({
    entitled: mocks.entitled,
    reason: mocks.entitled ? 'capability' : 'not_entitled',
    feature,
    label: 'Insights',
    currentPlan: 'free',
    requiredPlan: 'teams',
    capability: 'session-replay',
  })),
  tenantHasFeature: vi.fn(),
  toTenantPlan: vi.fn(),
}));
vi.mock('../../application/replay/ReplayHeatmapService', () => ({
  ReplayHeatmapService: vi.fn(function ReplayHeatmapService() { return mocks.heat; }),
}));
vi.mock('../../application/replay/replaySites', () => ({ getSiteForTenant: mocks.getSiteForTenant }));

import { errorHandler } from '../middleware/errorHandler';
import { createReplayHeatmapRoutes } from './replayHeatmapRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function call(path: string, tenant?: number) {
  const router = createReplayHeatmapRoutes();
  router.onError(errorHandler as never);
  const headers = new Headers();
  if (tenant) headers.set('x-tenant', String(tenant));
  return router.request(path, { headers }, {} as never, ctx);
}

const PATHS = [
  ['grid', '/heatmap/grid'],
  ['elements', '/heatmap/elements'],
  ['scrollDepth', '/heatmap/scroll'],
  ['routes', '/heatmap/routes'],
  ['insights', '/heatmap/insights'],
  ['snapshot', '/heatmap/snapshot'],
] as const;

beforeEach(() => {
  mocks.entitled = true;
  for (const fn of Object.values(mocks.heat)) fn.mockReset().mockResolvedValue({ ok: true });
  mocks.getSiteForTenant.mockReset();
  mocks.getSiteForTenant.mockImplementation(async (_env: unknown, _db: unknown, tenantId: number, siteId: string) => {
    if (tenantId !== 7 || siteId !== OWN_SITE) throw new ForbiddenError('That Insights site is not in this workspace');
    return { id: siteId, tenantId };
  });
});

describe('scope (D17)', () => {
  it.each(PATHS)('%s answers 403 for another workspace’s site and reads nothing', async (method, path) => {
    const res = await call(`${path}?site=${OTHER_SITE}&route=/`);
    expect(res.status).toBe(403);
    expect(mocks.heat[method]).not.toHaveBeenCalled();
  });

  it.each(PATHS)('%s answers 403 when a member of another workspace names this site', async (method, path) => {
    const res = await call(`${path}?site=${OWN_SITE}&route=/`, 8);
    expect(res.status).toBe(403);
    expect(mocks.heat[method]).not.toHaveBeenCalled();
  });

  it('answers 400 without a site', async () => {
    expect((await call('/heatmap/grid?route=/')).status).toBe(400);
  });
});

describe('the Insights gate', () => {
  it.each(PATHS)('%s answers 403 when Insights is not installed, before the site lookup', async (method, path) => {
    mocks.entitled = false;
    const res = await call(`${path}?site=${OWN_SITE}&route=/`);
    expect(res.status).toBe(403);
    expect(mocks.heat[method]).not.toHaveBeenCalled();
    expect(mocks.getSiteForTenant).not.toHaveBeenCalled();
  });
});

describe('query hand-off', () => {
  it('passes every heatmap parameter to the service with the caller’s scope', async () => {
    const res = await call(`/heatmap/elements?site=${OWN_SITE}&route=%2Fpricing&release=r2&compare=r1&device=phone&kind=rage&days=14`);
    expect(res.status).toBe(200);
    expect(mocks.heat.elements).toHaveBeenCalledWith(
      { tenantId: 7, siteId: OWN_SITE },
      { route: '/pricing', release: 'r2', compare: 'r1', device: 'phone', kind: 'rage', days: 14 },
    );
  });

  it('reads the top routes for the window', async () => {
    mocks.heat.routes.mockResolvedValue([{ route: '/', sessions: 1, pageviews: 2 }]);
    const res = await call(`/heatmap/routes?site=${OWN_SITE}&days=7`);
    expect(await res.json()).toEqual([{ route: '/', sessions: 1, pageviews: 2 }]);
    expect(mocks.heat.routes).toHaveBeenCalledWith({ tenantId: 7, siteId: OWN_SITE }, 7);
  });
});
