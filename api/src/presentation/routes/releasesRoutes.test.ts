import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 88;
const SEGMENT = 'seg-default';

const svc = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('tenantId', TENANT);
    c.set('segmentId', SEGMENT);
    await next();
  },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

const cache = vi.hoisted(() => ({ bump: vi.fn(async () => undefined) }));
vi.mock('../../infrastructure/cache/readThroughCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/cache/readThroughCache')>()),
  bumpCacheVersionSafe: cache.bump,
}));

vi.mock('../../application/delivery/ProductReleaseService', () => ({
  ProductReleaseService: function ProductReleaseService() { return svc; },
}));

import { createReleasesRoutes } from './releasesRoutes';
import { createProductRoutes } from './productRoutes';

const json = (method: string, b: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const SCOPE = { tenantId: TENANT, segmentId: SEGMENT };

describe('releases — ONE use case, canonical path + legacy alias', () => {
  beforeEach(() => vi.clearAllMocks());

  it('canonical GET /api/releases answers the enveloped list + its plan-vs-actual schedule in the caller scope', async () => {
    const releases = [
      { id: 'r1', name: 'v1', status: 'released', targetDate: '2026-09-01T00:00:00.000Z', releasedAt: '2026-09-03T10:00:00.000Z' },
      { id: 'r2', name: 'v2', status: 'released', targetDate: '2026-09-10T00:00:00.000Z', releasedAt: '2026-09-10T18:00:00.000Z' },
    ];
    svc.list.mockResolvedValue(releases);
    const res = await createReleasesRoutes({} as never).request('/?projectId=4');
    expect(res.status).toBe(200);
    const body = await res.json() as { releases: unknown[]; schedule: Record<string, unknown> };
    expect(body.releases).toEqual(releases);
    expect(body.schedule).toMatchObject({ released: 2, measured: 2, onTime: 1, late: 1, onTimeRatePct: 50, avgDaysLate: 2 });
    expect(svc.list).toHaveBeenCalledWith(SCOPE, 4);
    expect(res.headers.get('Deprecation')).toBeNull();
  });

  it('alias GET /api/product/release-planning reads the SAME service, keeps the bare-array shape, and names its successor', async () => {
    svc.list.mockResolvedValue([{ id: 'r1', name: 'v1', targetDate: null, releasedAt: null }]);
    const res = await createProductRoutes({} as never).request('/release-planning');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'r1', name: 'v1', targetDate: null, releasedAt: null, releaseDate: null }]);
    expect(svc.list).toHaveBeenCalledWith(SCOPE);
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toBe('</api/releases>; rel="successor-version"');
  });

  it('alias POST writes through the service (segment-stamped by scope), carrying the deprecated releaseDate for the service to fold', async () => {
    svc.create.mockResolvedValue({ id: 'r2', name: 'v2' });
    const res = await createProductRoutes({} as never).request('/release-planning', json('POST', { name: ' v2 ', releaseDate: '2026-11-01' }));
    expect(res.status).toBe(201);
    expect(svc.create).toHaveBeenCalledWith(SCOPE, expect.objectContaining({ name: 'v2', releaseDate: '2026-11-01' }));
  });

  it('alias rows keep the deprecated releaseDate: the ship date when shipped, else the target', async () => {
    svc.list.mockResolvedValue([
      { id: 'r1', name: 'shipped', status: 'released', targetDate: '2026-09-01T00:00:00.000Z', releasedAt: '2026-09-03T10:00:00.000Z' },
      { id: 'r2', name: 'planned', status: 'planned', targetDate: '2026-12-01T00:00:00.000Z', releasedAt: null },
    ]);
    const rows = await (await createProductRoutes({} as never).request('/release-planning')).json() as Array<{ releaseDate: string | null }>;
    expect(rows.map((r) => r.releaseDate)).toEqual(['2026-09-03T10:00:00.000Z', '2026-12-01T00:00:00.000Z']);

    svc.update.mockResolvedValue({ id: 'r2', name: 'planned', targetDate: '2026-12-02T00:00:00.000Z', releasedAt: null });
    const patched = await (await createProductRoutes({} as never).request('/release-planning/r2', json('PATCH', { releaseDate: '2026-12-02' }))).json();
    expect(patched).toMatchObject({ releaseDate: '2026-12-02T00:00:00.000Z' });
  });

  it('canonical rows do NOT carry the deprecated releaseDate', async () => {
    svc.list.mockResolvedValue([{ id: 'r2', name: 'planned', status: 'planned', targetDate: '2026-12-01T00:00:00.000Z', releasedAt: null }]);
    const body = await (await createReleasesRoutes({} as never).request('/')).json() as { releases: object[] };
    expect(body.releases[0]).not.toHaveProperty('releaseDate');
  });

  it('alias POST without a name is refused before the service', async () => {
    const res = await createProductRoutes({} as never).request('/release-planning', json('POST', { version: '1.0' }));
    expect(res.status).toBe(400);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('alias DELETE keeps the tracker 404 for a missing row; canonical DELETE stays idempotent', async () => {
    svc.remove.mockResolvedValue(false);
    expect((await createProductRoutes({} as never).request('/release-planning/x', { method: 'DELETE' })).status).toBe(404);
    const canonical = await createReleasesRoutes({} as never).request('/x', { method: 'DELETE' });
    expect(canonical.status).toBe(200);
    expect(await canonical.json()).toEqual({ deleted: 'x' });
  });

  it('every release write bumps the delivery-insights version token for the tenant; reads and misses do not', async () => {
    const DELIVERY_KEY = `insights-delivery-version:tenant:${TENANT}`;
    const canonical = createReleasesRoutes({} as never);
    const alias = createProductRoutes({} as never);
    svc.create.mockResolvedValue({ id: 'r1', name: 'v1', targetDate: null, releasedAt: null });
    svc.update.mockResolvedValue({ id: 'r1', name: 'v1', targetDate: null, releasedAt: null });
    svc.remove.mockResolvedValue(true);
    svc.list.mockResolvedValue([]);

    await canonical.request('/', json('POST', { name: 'v1' }));
    await canonical.request('/r1', json('PATCH', { status: 'released' }));
    await canonical.request('/r1', { method: 'DELETE' });
    await alias.request('/release-planning', json('POST', { name: 'v1' }));
    await alias.request('/release-planning/r1', json('PATCH', { status: 'released' }));
    await alias.request('/release-planning/r1', { method: 'DELETE' });
    expect(cache.bump).toHaveBeenCalledTimes(6);
    for (const call of cache.bump.mock.calls as unknown as unknown[][]) expect(call[1]).toBe(DELIVERY_KEY);

    cache.bump.mockClear();
    await canonical.request('/');                                   // a read
    svc.update.mockResolvedValue(null);
    await canonical.request('/missing', json('PATCH', { name: 'x' })); // 404
    svc.remove.mockResolvedValue(false);
    await canonical.request('/missing', { method: 'DELETE' });        // nothing removed
    await alias.request('/release-planning', json('POST', { version: '1.0' })); // 400, no name
    expect(cache.bump).not.toHaveBeenCalled();
  });
});
