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

vi.mock('../../application/delivery/ProductReleaseService', () => ({
  ProductReleaseService: function ProductReleaseService() { return svc; },
}));

import { createReleasesRoutes } from './releasesRoutes';
import { createProductRoutes } from './productRoutes';

const json = (method: string, b: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const SCOPE = { tenantId: TENANT, segmentId: SEGMENT };

describe('releases — ONE use case, canonical path + legacy alias', () => {
  beforeEach(() => vi.clearAllMocks());

  it('canonical GET /api/releases answers the enveloped list in the caller scope', async () => {
    svc.list.mockResolvedValue([{ id: 'r1', name: 'v1' }]);
    const res = await createReleasesRoutes({} as never).request('/?projectId=4');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ releases: [{ id: 'r1', name: 'v1' }] });
    expect(svc.list).toHaveBeenCalledWith(SCOPE, 4);
    expect(res.headers.get('Deprecation')).toBeNull();
  });

  it('alias GET /api/product/release-planning reads the SAME service, keeps the bare-array shape, and names its successor', async () => {
    svc.list.mockResolvedValue([{ id: 'r1', name: 'v1' }]);
    const res = await createProductRoutes({} as never).request('/release-planning');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'r1', name: 'v1' }]);
    expect(svc.list).toHaveBeenCalledWith(SCOPE);
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toBe('</api/releases>; rel="successor-version"');
  });

  it('alias POST writes through the service (segment-stamped by scope), carrying releaseDate', async () => {
    svc.create.mockResolvedValue({ id: 'r2', name: 'v2' });
    const res = await createProductRoutes({} as never).request('/release-planning', json('POST', { name: ' v2 ', releaseDate: '2026-11-01' }));
    expect(res.status).toBe(201);
    expect(svc.create).toHaveBeenCalledWith(SCOPE, expect.objectContaining({ name: 'v2', releaseDate: '2026-11-01' }));
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
});
