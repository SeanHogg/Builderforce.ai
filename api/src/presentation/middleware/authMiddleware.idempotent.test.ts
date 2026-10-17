/**
 * authMiddleware is idempotent within a request: several routers mount on one
 * prefix (`/api/projects`, `/api/insights`) and each runs it, so a request must
 * verify its token once, not once per mount.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  verifyJwt: vi.fn(),
  resolveActiveToken: vi.fn(),
  resolveTenantMembership: vi.fn(),
}));

vi.mock('../../infrastructure/auth/JwtService', () => ({ verifyJwt: mocks.verifyJwt }));
vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: () => ({}) }));
vi.mock('../../application/auth/sessionRevocation', () => ({
  sessionVersionOf: vi.fn(async () => 0),
  resolveActiveToken: mocks.resolveActiveToken,
}));
vi.mock('../../application/legal/termsAcceptance', () => ({
  checkTermsAcceptance: vi.fn(async () => ({ needsAcceptance: false })),
}));
vi.mock('../../infrastructure/auth/segmentResolver', () => ({ resolveSegment: vi.fn(async () => 'seg-1') }));
vi.mock('../../application/auth/tenantMembership', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../application/auth/tenantMembership')>();
  return { ...actual, resolveTenantMembership: mocks.resolveTenantMembership };
});

import type { HonoEnv } from '../../env';
import { authMiddleware } from './authMiddleware';
import { errorHandler } from './errorHandler';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;
const env = { JWT_SECRET: 's' } as never;

/** Two routers mounted on the same prefix, each guarding itself with authMiddleware —
 *  the shape `index.ts` uses for `/api/projects`. The request reaches the second. */
function stackedApp() {
  const first = new Hono<HonoEnv>();
  first.use('*', authMiddleware);
  first.get('/other', (c) => c.json({ router: 'first' }));

  const second = new Hono<HonoEnv>();
  second.use('*', authMiddleware);
  second.get('/x', (c) => c.json({ userId: c.get('userId'), tenantId: c.get('tenantId') }));

  const app = new Hono<HonoEnv>();
  app.onError(errorHandler as never);
  app.route('/api/p', first);
  app.route('/api/p', second);
  return app;
}

beforeEach(() => {
  mocks.verifyJwt.mockReset();
  mocks.verifyJwt.mockImplementation(async () => ({ sub: 'user-1', tid: 7, role: 'manager', jti: 'j1' }));
  mocks.resolveActiveToken.mockReset();
  mocks.resolveActiveToken.mockImplementation(async () => ({ active: {}, writes: [] }));
  mocks.resolveTenantMembership.mockReset();
  mocks.resolveTenantMembership.mockImplementation(async () => ({ isSuperadmin: false, role: 'manager' }));
});

describe('authMiddleware stacked mounts', () => {
  it('verifies the token once across two stacked mounts', async () => {
    const res = await stackedApp().request('/api/p/x', { headers: { Authorization: 'Bearer t' } }, env, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'user-1', tenantId: 7 });
    expect(mocks.verifyJwt).toHaveBeenCalledTimes(1);
    expect(mocks.resolveActiveToken).toHaveBeenCalledTimes(1);
    expect(mocks.resolveTenantMembership).toHaveBeenCalledTimes(1);
  });

  it('does not mark the request verified when the first pass is refused', async () => {
    mocks.resolveTenantMembership.mockImplementation(async () => null);
    const res = await stackedApp().request('/api/p/x', { headers: { Authorization: 'Bearer t' } }, env, ctx);
    expect(res.status).toBe(401);
    expect(mocks.verifyJwt).toHaveBeenCalledTimes(1);
  });

  it('still rejects a request with no token on every mount', async () => {
    const res = await stackedApp().request('/api/p/x', {}, env, ctx);
    expect(res.status).toBe(401);
    expect(mocks.verifyJwt).not.toHaveBeenCalled();
  });
});
