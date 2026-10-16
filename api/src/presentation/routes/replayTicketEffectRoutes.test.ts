/**
 * `GET /api/replay/ticket-effect/:taskId` — behind the Insights gate (the effect is
 * read from recordings), refused under superadmin emulation (D17), and scoped to the
 * caller's workspace. Auth is a header-driven stand-in; `effectFor` is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The gate's proof-site clause: no workspace here reads its own live proof site.
vi.mock('../../application/replay/proofSiteRead', () => ({ readsOwnProofSite: async () => false }));
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';

const mocks = vi.hoisted(() => ({
  entitled: true,
  effectFor: vi.fn(),
}));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/authMiddleware')>();
  const fakeAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    c.set('tenantId', 7);
    c.set('userId', 'u1');
    c.set('role', 'developer' as never);
    c.set('db', {} as never);
    if (c.req.header('x-emulation')) c.set('isEmulation', true);
    await next();
  };
  return { ...real, authMiddleware: fakeAuth };
});
vi.mock('../../application/tenant/featureEntitlements', () => ({
  resolveFeatureEntitlement: vi.fn(async (_env: unknown, _t: number, _u: unknown, feature: string) => ({
    entitled: mocks.entitled, reason: mocks.entitled ? 'capability' : 'not_entitled', feature,
    label: 'Insights', currentPlan: 'free', requiredPlan: 'teams', capability: 'session-replay',
  })),
  tenantHasFeature: vi.fn(),
  toTenantPlan: vi.fn(),
}));
vi.mock('../../application/replay/ticketEffect', () => ({ effectFor: mocks.effectFor }));
vi.mock('../../application/shared/dbHandle', () => ({
  requestDb: (c: { get(key: 'db'): unknown }) => c.get('db') ?? {},
}));

import { errorHandler } from '../middleware/errorHandler';
import { createReplayTicketEffectRoutes } from './replayTicketEffectRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function call(path: string, headers: Record<string, string> = {}) {
  const router = createReplayTicketEffectRoutes();
  router.onError(errorHandler as never);
  return router.request(path, { headers }, {} as never, ctx);
}

beforeEach(() => {
  mocks.entitled = true;
  mocks.effectFor.mockReset().mockResolvedValue(null);
});

describe('GET /ticket-effect/:taskId', () => {
  it('answers the effect for a workspace holding Insights, scoped to the caller', async () => {
    const res = await call('/ticket-effect/12');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ effect: null });
    expect(mocks.effectFor).toHaveBeenCalledWith({}, {}, { tenantId: 7, taskId: 12 });
  });

  it('is behind the Insights gate', async () => {
    mocks.entitled = false;
    expect((await call('/ticket-effect/12')).status).toBe(403);
    expect(mocks.effectFor).not.toHaveBeenCalled();
  });

  it('is refused under superadmin emulation', async () => {
    expect((await call('/ticket-effect/12', { 'x-emulation': '1' })).status).toBe(403);
    expect(mocks.effectFor).not.toHaveBeenCalled();
  });

  it('400s a malformed task id', async () => {
    expect((await call('/ticket-effect/abc')).status).toBe(400);
  });
});
