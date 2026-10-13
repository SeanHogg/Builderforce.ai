/**
 * `/api/capabilities` — the state read any member may make, the pack ladder, and
 * the checkout's role + permission gate and its 503 when payments are unconfigured.
 * Auth is a header-driven stand-in; `requireRole` and `requirePermission` are the
 * real middleware (the permission resolver underneath is mocked).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';

const mocks = vi.hoisted(() => ({
  capabilityState: vi.fn(),
  loadReplayPacks: vi.fn(),
  startReplayPackCheckout: vi.fn(),
  memberHasPermission: vi.fn(),
}));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/authMiddleware')>();
  const fakeAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    c.set('tenantId', Number(c.req.header('x-tenant') ?? 7));
    c.set('userId', 'u1');
    c.set('role', (c.req.header('x-role') ?? 'developer') as never);
    c.set('db', {} as never);
    await next();
  };
  return { ...real, authMiddleware: fakeAuth };
});
vi.mock('../../application/rbac/effectivePermissions', () => ({ memberHasPermission: mocks.memberHasPermission }));
vi.mock('../../application/tenant/capabilityState', () => ({ capabilityState: mocks.capabilityState }));
vi.mock('../../application/commerce/replayPacks', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../application/commerce/replayPacks')>();
  return { ...real, loadReplayPacks: mocks.loadReplayPacks, startReplayPackCheckout: mocks.startReplayPackCheckout };
});

import { errorHandler } from '../middleware/errorHandler';
import { ReplayCommerceError } from '../../application/commerce/replayPacks';
import { createCapabilityRoutes } from './capabilityRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function call(path: string, init: RequestInit & { role?: string } = {}) {
  const router = createCapabilityRoutes({} as never);
  router.onError(errorHandler as never);
  const headers = new Headers(init.headers);
  if (init.role) headers.set('x-role', init.role);
  if (init.body) headers.set('content-type', 'application/json');
  return router.request(path, { ...init, headers }, {} as never, ctx);
}

const STATE = {
  slug: 'session-replay', installed: true, entitled: true, siteCount: 2,
  usage: { period: '2026-10', freeAllowance: 5_000, freeUsed: 12, credits: 0, used: 12, limit: 5_000 },
};

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('GET /:slug/state', () => {
  it('answers any member with the CapabilityStateDto, ungated by the capability', async () => {
    mocks.capabilityState.mockResolvedValue(STATE);
    const res = await call('/session-replay/state', { role: 'viewer' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(STATE);
    expect(mocks.capabilityState).toHaveBeenCalledWith({}, {}, { tenantId: 7, userId: 'u1', slug: 'session-replay' });
  });

  it('404s an unknown capability', async () => {
    mocks.capabilityState.mockResolvedValue(null);
    expect((await call('/nope/state')).status).toBe(404);
  });
});

describe('GET /session-replay/packs', () => {
  it('lists the published ladder as ReplayPackDto[]', async () => {
    mocks.loadReplayPacks.mockResolvedValue([{ id: 'p10k', units: 10_000, amountCents: 4_000 }]);
    const res = await call('/session-replay/packs');
    expect(await res.json()).toEqual([{ id: 'p10k', units: 10_000, amountCents: 4_000 }]);
  });
});

describe('POST /session-replay/packs/:packId/checkout', () => {
  const post = (role: string) => call('/session-replay/packs/p10k/checkout', {
    method: 'POST', role, body: JSON.stringify({ returnUrl: 'https://builderforce.ai/apps/insights' }),
  });

  it('refuses a developer before any permission or checkout work', async () => {
    const res = await post('developer');
    expect(res.status).toBe(403);
    expect(mocks.memberHasPermission).not.toHaveBeenCalled();
    expect(mocks.startReplayPackCheckout).not.toHaveBeenCalled();
  });

  it('refuses a manager without billing:manage', async () => {
    mocks.memberHasPermission.mockResolvedValue(false);
    const res = await post('manager');
    expect(res.status).toBe(403);
    expect(mocks.memberHasPermission.mock.calls[0]?.[4]).toBe('billing:manage');
    expect(mocks.startReplayPackCheckout).not.toHaveBeenCalled();
  });

  it('returns the hosted checkout URL for a manager with billing:manage', async () => {
    mocks.memberHasPermission.mockResolvedValue(true);
    mocks.startReplayPackCheckout.mockResolvedValue({
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_1', sessionId: 'cs_1', pack: { id: 'p10k', units: 10_000, amountCents: 4_000 },
    });
    const res = await post('manager');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_1' });
    expect(mocks.startReplayPackCheckout).toHaveBeenCalledWith({}, {}, {
      tenantId: 7, buyerRef: 'u1', actorId: 'u1', packId: 'p10k', returnUrl: 'https://builderforce.ai/apps/insights',
    });
  });

  it('answers 503 when payments are not configured', async () => {
    mocks.memberHasPermission.mockResolvedValue(true);
    mocks.startReplayPackCheckout.mockRejectedValue(new ReplayCommerceError('Payments are not configured', 503));
    expect((await post('owner')).status).toBe(503);
  });

  it('400s a body without a returnUrl', async () => {
    mocks.memberHasPermission.mockResolvedValue(true);
    const res = await call('/session-replay/packs/p10k/checkout', { method: 'POST', role: 'manager', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });
});
