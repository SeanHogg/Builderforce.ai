import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  payload: {} as Record<string, unknown>,
  isSuperadmin: true,
  resolveIsSuperadmin: vi.fn(),
}));

vi.mock('../../infrastructure/auth/JwtService', () => ({ verifyWebJwt: vi.fn(async () => mocks.payload) }));
vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: () => ({}) }));
vi.mock('../../infrastructure/auth/superadminFlag', () => ({ resolveIsSuperadmin: mocks.resolveIsSuperadmin }));
vi.mock('../../application/legal/termsAcceptance', () => ({
  checkTermsAcceptance: vi.fn(async () => ({ needsAcceptance: false })),
}));

import type { HonoEnv } from '../../env';
import { superAdminMiddleware } from './superAdminMiddleware';
import { errorHandler } from './errorHandler';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

async function call() {
  const app = new Hono<HonoEnv>();
  app.onError(errorHandler as never);
  app.get('/api/admin/x', superAdminMiddleware, (c) => c.json({ userId: c.get('userId') }));
  return app.request('/api/admin/x', { headers: { Authorization: 'Bearer t' } }, { JWT_SECRET: 's' } as never, ctx);
}

beforeEach(() => {
  mocks.payload = { sub: 'sa-1', sa: true };
  mocks.isSuperadmin = true;
  mocks.resolveIsSuperadmin.mockReset();
  mocks.resolveIsSuperadmin.mockImplementation(async () => mocks.isSuperadmin);
});

describe('superAdminMiddleware', () => {
  it('admits a superadmin through the cached flag resolver (no direct users SELECT)', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.resolveIsSuperadmin).toHaveBeenCalledWith(expect.anything(), 'sa-1');
  });

  it('refuses when the DB flag has been revoked, even with an `sa` claim', async () => {
    mocks.isSuperadmin = false;
    expect((await call()).status).toBe(403);
  });

  it('refuses a token without the `sa` claim before consulting the flag', async () => {
    mocks.payload = { sub: 'u-1' };
    expect((await call()).status).toBe(403);
    expect(mocks.resolveIsSuperadmin).not.toHaveBeenCalled();
  });

  it('refuses emulation tokens', async () => {
    mocks.payload = { sub: 'sa-1', sa: true, emu: true };
    expect((await call()).status).toBe(403);
  });
});
