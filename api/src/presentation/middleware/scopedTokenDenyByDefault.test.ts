/**
 * SEC-G017: a scoped (`aud`) token is refused by webAuthMiddleware, optionalWebUserId and
 * superAdminMiddleware (and so by every route behind them, e.g. POST /api/auth/editor-key and
 * POST /api/auth/tenant-token). Uses the REAL JwtService so the verifier itself is under test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({ resolveIsSuperadmin: vi.fn(async () => true) }));

vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: () => ({}) }));
vi.mock('../../infrastructure/auth/superadminFlag', () => ({ resolveIsSuperadmin: mocks.resolveIsSuperadmin }));
vi.mock('../../application/legal/termsAcceptance', () => ({
  checkTermsAcceptance: vi.fn(async () => ({ needsAcceptance: false })),
}));
vi.mock('../../application/auth/sessionRevocation', () => ({
  resolveActiveToken: vi.fn(async () => ({ active: {}, writes: [] })),
  findActiveTokenCached: vi.fn(async () => ({})),
  assertActiveToken: vi.fn(),
}));

import type { HonoEnv } from '../../env';
import { signJwt, signWebJwt } from '../../infrastructure/auth/JwtService';
import { TenantRole } from '../../domain/shared/types';
import { webAuthMiddleware, optionalWebUserId } from './webAuthMiddleware';
import { superAdminMiddleware } from './superAdminMiddleware';
import { errorHandler } from './errorHandler';

const SECRET = 's';
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;
const reached = vi.fn();

function app() {
  const a = new Hono<HonoEnv>();
  a.onError(errorHandler as never);
  for (const path of ['/api/auth/editor-key', '/api/auth/tenant-token', '/api/auth/mfa/disable', '/api/auth/sessions/revoke-others']) {
    a.post(path, webAuthMiddleware, (c) => { reached(); return c.json({ ok: true }); });
  }
  a.get('/optional', async (c) => c.json({ userId: await optionalWebUserId(c) }));
  a.get('/api/admin/x', superAdminMiddleware, (c) => { reached(); return c.json({ ok: true }); });
  return a;
}

const call = (path: string, token: string, method = 'POST') =>
  app().request(path, { method, headers: { Authorization: `Bearer ${token}` } }, { JWT_SECRET: SECRET } as never, ctx);

let scoped: string;
let scopedSa: string;
let normalWeb: string;
let normalSa: string;

beforeEach(async () => {
  reached.mockClear();
  scoped = await signJwt({ sub: 'u1', tid: 7, role: TenantRole.MANAGER, aud: 'spawn' }, SECRET, 900);
  scopedSa = await signJwt({ sub: 'sa-1', tid: 7, role: TenantRole.OWNER, aud: 'spawn', sa: true } as never, SECRET, 900);
  normalWeb = await signWebJwt({ sub: 'u1', email: 'a@b.c', username: 'u' }, SECRET);
  normalSa = await signWebJwt({ sub: 'sa-1', email: 'a@b.c', username: 'sa', sa: true }, SECRET);
});

describe('scoped token is refused', () => {
  it.each(['/api/auth/editor-key', '/api/auth/tenant-token', '/api/auth/mfa/disable', '/api/auth/sessions/revoke-others'])(
    'by webAuthMiddleware on POST %s',
    async (path) => {
      expect((await call(path, scoped)).status).toBe(401);
      expect(reached).not.toHaveBeenCalled();
    },
  );

  it('by optionalWebUserId (anonymous)', async () => {
    const res = await call('/optional', scoped, 'GET');
    expect(await res.json()).toEqual({ userId: null });
  });

  it('by superAdminMiddleware, even with an sa claim', async () => {
    expect((await call('/api/admin/x', scopedSa, 'GET')).status).toBe(401);
    expect(reached).not.toHaveBeenCalled();
  });
});

describe('normal tokens are unaffected', () => {
  it('webAuthMiddleware admits a web token', async () => {
    expect((await call('/api/auth/editor-key', normalWeb)).status).toBe(200);
  });

  it('optionalWebUserId identifies a web token', async () => {
    expect(await (await call('/optional', normalWeb, 'GET')).json()).toEqual({ userId: 'u1' });
  });

  it('superAdminMiddleware admits a superadmin web token', async () => {
    expect((await call('/api/admin/x', normalSa, 'GET')).status).toBe(200);
  });
});
