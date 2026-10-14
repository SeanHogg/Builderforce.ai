/**
 * `/api/projects/:projectId/replay/site` — the project-ownership gate, the Insights
 * gate, MANAGER on the switch, and `null` for a project that never switched on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';

const mocks = vi.hoisted(() => ({
  entitled: true,
  projectInTenantCached: vi.fn(),
  projectSiteDto: vi.fn(),
  createHostedSite: vi.fn(),
}));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/authMiddleware')>();
  const fakeAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    c.set('tenantId', 7);
    c.set('userId', 'u1');
    c.set('role', (c.req.header('x-role') ?? 'developer') as never);
    if (c.req.header('x-emulation')) c.set('isEmulation', true);
    await next();
  };
  return { ...real, authMiddleware: fakeAuth };
});
vi.mock('../../application/tenant/featureEntitlements', () => ({
  resolveFeatureEntitlement: vi.fn(async (_env: unknown, _tenantId: number, _userId: unknown, feature: string) => ({
    entitled: mocks.entitled, reason: mocks.entitled ? 'capability' : 'not_entitled', feature, label: 'Insights',
    currentPlan: 'free', requiredPlan: 'teams', capability: 'session-replay',
  })),
  tenantHasFeature: vi.fn(),
  toTenantPlan: vi.fn(),
}));
vi.mock('../../application/project/projectOwnership', () => ({ projectInTenantCached: mocks.projectInTenantCached }));
vi.mock('../../application/replay/replaySiteAdmin', () => ({
  projectSiteDto: mocks.projectSiteDto,
  createHostedSite: mocks.createHostedSite,
}));

import { errorHandler } from '../middleware/errorHandler';
import { createReplayProjectRoutes } from './replayProjectRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function call(path: string, init: RequestInit & { role?: string } = {}) {
  const router = createReplayProjectRoutes({} as never);
  router.onError(errorHandler as never);
  const headers = new Headers(init.headers);
  if (init.role) headers.set('x-role', init.role);
  return router.request(path, { ...init, headers }, {} as never, ctx);
}

beforeEach(() => {
  mocks.entitled = true;
  for (const fn of [mocks.projectInTenantCached, mocks.projectSiteDto, mocks.createHostedSite]) fn.mockReset();
  mocks.projectInTenantCached.mockImplementation(async (_env: unknown, _db: unknown, tenantId: number, projectId: number) =>
    tenantId === 7 && projectId === 42);
});

describe('GET /:projectId/replay/site', () => {
  it('answers null for an owned project that never switched recording on', async () => {
    mocks.projectSiteDto.mockResolvedValue(null);
    const res = await call('/42/replay/site');
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
    expect(mocks.projectSiteDto).toHaveBeenCalledWith({}, {}, 7, 42);
  });

  it('answers the hosted site when there is one', async () => {
    mocks.projectSiteDto.mockResolvedValue({ id: 'site-1', kind: 'hosted', projectId: 42 });
    expect(await (await call('/42/replay/site')).json()).toEqual({ id: 'site-1', kind: 'hosted', projectId: 42 });
  });

  it('404s a project of another workspace, or a malformed id', async () => {
    expect((await call('/43/replay/site')).status).toBe(404);
    expect((await call('/abc/replay/site')).status).toBe(404);
    expect(mocks.projectSiteDto).not.toHaveBeenCalled();
  });

  it('is gated on Insights', async () => {
    mocks.entitled = false;
    const res = await call('/42/replay/site');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'capability_required' });
  });
});

describe('POST /:projectId/replay/site', () => {
  it('refuses a developer', async () => {
    expect((await call('/42/replay/site', { method: 'POST', role: 'developer' })).status).toBe(403);
    expect(mocks.createHostedSite).not.toHaveBeenCalled();
  });

  it('switches recording on for a manager, as the caller, in the caller workspace', async () => {
    mocks.createHostedSite.mockResolvedValue({ id: 'site-1', kind: 'hosted', projectId: 42, status: 'active' });
    const res = await call('/42/replay/site', { method: 'POST', role: 'manager' });
    expect(res.status).toBe(201);
    expect(mocks.createHostedSite).toHaveBeenCalledWith({}, {}, { tenantId: 7, projectId: 42, userId: 'u1' });
  });

  it('404s a manager switching on another workspace project', async () => {
    expect((await call('/43/replay/site', { method: 'POST', role: 'manager' })).status).toBe(404);
    expect(mocks.createHostedSite).not.toHaveBeenCalled();
  });
});

describe('superadmin emulation (D17)', () => {
  it('403s the project site read before the ownership check', async () => {
    const res = await call('/42/replay/site', { headers: { 'x-emulation': '1' } });
    expect(res.status).toBe(403);
    expect(mocks.projectInTenantCached).not.toHaveBeenCalled();
    expect(mocks.projectSiteDto).not.toHaveBeenCalled();
  });
});
