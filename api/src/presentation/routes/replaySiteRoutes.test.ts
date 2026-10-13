/**
 * `/api/replay/sites` — the Insights gate, MANAGER on writes, and the D17 rule that
 * a site is only ever addressed inside the caller's own workspace. Auth is a
 * header-driven stand-in; `requireRole` and `requireFeature` are the real
 * middleware, with the entitlement verdict and the site service mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { ForbiddenError } from '../../domain/shared/errors';

const OWN_SITE = '11111111-2222-4333-8444-555555555555';

const mocks = vi.hoisted(() => ({
  entitled: true,
  listSiteDtos: vi.fn(),
  getSiteDto: vi.fn(),
  createExternalSite: vi.fn(),
  updateSite: vi.fn(),
  siteVerify: vi.fn(),
}));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/authMiddleware')>();
  const fakeAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    c.set('tenantId', Number(c.req.header('x-tenant') ?? 7));
    c.set('userId', 'u1');
    c.set('role', (c.req.header('x-role') ?? 'developer') as never);
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
vi.mock('../../application/replay/replaySiteAdmin', () => ({
  listSiteDtos: mocks.listSiteDtos,
  getSiteDto: mocks.getSiteDto,
  createExternalSite: mocks.createExternalSite,
  updateSite: mocks.updateSite,
  siteVerify: mocks.siteVerify,
}));

import { errorHandler } from '../middleware/errorHandler';
import { createReplaySiteRoutes } from './replaySiteRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function call(path: string, init: RequestInit & { role?: string; tenant?: number } = {}) {
  const router = createReplaySiteRoutes({} as never);
  router.onError(errorHandler as never);
  const headers = new Headers(init.headers);
  if (init.role) headers.set('x-role', init.role);
  if (init.tenant) headers.set('x-tenant', String(init.tenant));
  if (init.body) headers.set('content-type', 'application/json');
  return router.request(path, { ...init, headers }, {} as never, ctx);
}

/** The application rule the route must feed with the CALLER's tenant: site 7 only. */
const ownOnly = async (_db: unknown, _env: unknown, scope: { tenantId: number; siteId: string }) => {
  if (scope.tenantId !== 7 || scope.siteId !== OWN_SITE) throw new ForbiddenError('That Insights site is not in this workspace');
  return { id: scope.siteId };
};

beforeEach(() => {
  mocks.entitled = true;
  for (const fn of [mocks.listSiteDtos, mocks.getSiteDto, mocks.createExternalSite, mocks.updateSite, mocks.siteVerify]) fn.mockReset();
  mocks.getSiteDto.mockImplementation(async (env: unknown, db: unknown, scope: { tenantId: number; siteId: string }) => ownOnly(db, env, scope));
  mocks.updateSite.mockImplementation(ownOnly);
  mocks.siteVerify.mockImplementation(async (env: unknown, db: unknown, scope: { tenantId: number; siteId: string }) => {
    await ownOnly(db, env, scope);
    return { scriptSeen: true, originOk: true, firstEventAt: null, firstRecordingId: null };
  });
});

describe('the Insights gate', () => {
  it('answers 403 capability_required when the workspace has not installed Insights', async () => {
    mocks.entitled = false;
    const res = await call('/');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'capability_required', capability: 'session-replay', installRequired: true });
    expect(mocks.listSiteDtos).not.toHaveBeenCalled();
  });

  it('lists the caller workspace sites for any member of an installed workspace', async () => {
    mocks.listSiteDtos.mockResolvedValue([{ id: OWN_SITE }]);
    const res = await call('/', { role: 'developer' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: OWN_SITE }]);
    expect(mocks.listSiteDtos).toHaveBeenCalledWith({}, {}, 7);
  });
});

describe('writes need MANAGER', () => {
  const create = { label: 'Shop', allowedOrigins: ['https://shop.example.com'] };

  it('refuses a developer creating a site', async () => {
    const res = await call('/', { method: 'POST', role: 'developer', body: JSON.stringify(create) });
    expect(res.status).toBe(403);
    expect(mocks.createExternalSite).not.toHaveBeenCalled();
  });

  it('lets a manager create one, in the caller workspace, as the caller', async () => {
    mocks.createExternalSite.mockResolvedValue({ id: OWN_SITE, publicKey: 'bfr_x' });
    const res = await call('/', { method: 'POST', role: 'manager', body: JSON.stringify(create) });
    expect(res.status).toBe(201);
    expect(mocks.createExternalSite).toHaveBeenCalledWith({}, {}, {
      tenantId: 7, userId: 'u1', label: 'Shop', allowedOrigins: ['https://shop.example.com'], settings: undefined,
    });
  });

  it('refuses a developer changing a site', async () => {
    const res = await call(`/${OWN_SITE}`, { method: 'PATCH', role: 'developer', body: JSON.stringify({ label: 'x' }) });
    expect(res.status).toBe(403);
    expect(mocks.updateSite).not.toHaveBeenCalled();
  });

  it('400s a body of the wrong shape', async () => {
    const res = await call(`/${OWN_SITE}`, { method: 'PATCH', role: 'manager', body: JSON.stringify({ status: 'paused' }) });
    expect(res.status).toBe(400);
  });
});

describe('a site is only reachable inside the caller workspace (D17)', () => {
  it('403s a manager of another workspace patching the site', async () => {
    const res = await call(`/${OWN_SITE}`, { method: 'PATCH', role: 'manager', tenant: 8, body: JSON.stringify({ label: 'x' }) });
    expect(res.status).toBe(403);
    expect(mocks.updateSite.mock.calls[0]?.[2]).toEqual({ tenantId: 8, siteId: OWN_SITE });
  });

  it('403s another workspace reading the site', async () => {
    expect((await call(`/${OWN_SITE}`, { tenant: 8 })).status).toBe(403);
    expect(await (await call(`/${OWN_SITE}`, { tenant: 7 })).json()).toEqual({ id: OWN_SITE });
  });

  it('403s another workspace reading the install checks', async () => {
    expect((await call(`/${OWN_SITE}/verify`, { tenant: 8 })).status).toBe(403);
    expect((await call(`/${OWN_SITE}/verify`, { tenant: 7 })).status).toBe(200);
  });

  it('403s a malformed site id without touching the service', async () => {
    expect((await call('/not-a-uuid/verify')).status).toBe(403);
    expect(mocks.siteVerify).not.toHaveBeenCalled();
  });
});
