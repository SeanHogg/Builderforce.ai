/**
 * SEC-SYN-001: an audience-bound (scoped) token reaches only the paths its audience lists;
 * a token without `aud` behaves exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  payload: {} as Record<string, unknown>,
  resolveKey: vi.fn(async () => ({ valid: true, mayRescope: false })),
}));

vi.mock('../../application/llm/gatewayAccess', () => ({ resolveEditorKeySession: mocks.resolveKey }));

vi.mock('../../infrastructure/auth/JwtService', () => ({
  verifyJwt: vi.fn(async () => mocks.payload),
}));
vi.mock('../../infrastructure/database/connection', () => ({ buildDatabase: () => ({}) }));
vi.mock('../../application/auth/sessionRevocation', () => ({
  sessionVersionOf: vi.fn(async () => 0),
  resolveActiveToken: vi.fn(async () => ({ active: {}, writes: [] })),
}));
vi.mock('../../application/legal/termsAcceptance', () => ({
  checkTermsAcceptance: vi.fn(async () => ({ needsAcceptance: false })),
}));
vi.mock('../../infrastructure/auth/segmentResolver', () => ({ resolveSegment: vi.fn(async () => 'seg-1') }));
vi.mock('../../application/auth/tenantMembership', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../application/auth/tenantMembership')>();
  return { ...actual, resolveTenantMembership: vi.fn(async () => ({ isSuperadmin: false, role: 'manager' })) };
});

import type { HonoEnv } from '../../env';
import { authMiddleware } from './authMiddleware';
import { errorHandler } from './errorHandler';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function app() {
  const a = new Hono<HonoEnv>();
  a.onError(errorHandler as never);
  for (const path of ['/api/spawn/account', '/api/spawn/build', '/api/spawn/membership', '/api/spawn/tokens', '/api/projects']) {
    a.all(path, authMiddleware, (c) => c.json({ ok: true }));
  }
  return a;
}

async function call(path: string, method = 'GET') {
  return app().request(path, { method, headers: { Authorization: 'Bearer t' } }, { JWT_SECRET: 's' } as never, ctx);
}

beforeEach(() => {
  mocks.payload = { sub: 'user-1', tid: 7, role: 'manager', jti: 'j1', aud: 'spawn' };
});

describe('authMiddleware audience binding', () => {
  it.each(['/api/spawn/account', '/api/spawn/build'])('allows an aud:spawn token on %s', async (path) => {
    expect((await call(path, path.endsWith('build') ? 'POST' : 'GET')).status).toBe(200);
  });

  it.each(['/api/spawn/membership', '/api/spawn/tokens', '/api/projects'])(
    'refuses an aud:spawn token on %s with token_audience_forbidden',
    async (path) => {
      const res = await call(path);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'token_audience_forbidden' });
    },
  );

  it.each([['POST', '/api/spawn/account'], ['GET', '/api/spawn/build'], ['DELETE', '/api/spawn/account']])(
    'refuses the wrong method %s on %s',
    async (method, path) => {
      const res = await call(path, method);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'token_audience_forbidden' });
    },
  );

  it('is the only verifier call that opts in to audience tokens', async () => {
    const { verifyJwt } = await import('../../infrastructure/auth/JwtService');
    await call('/api/spawn/account');
    expect(verifyJwt).toHaveBeenCalledWith('t', 's', { allowAudience: true });
  });

  it('passes a scoped token whose editor key is still live', async () => {
    mocks.resolveKey.mockResolvedValue({ valid: true, mayRescope: false });
    mocks.payload = { ...mocks.payload, kid: 'key-1' };
    expect((await call('/api/spawn/account')).status).toBe(200);
    expect(mocks.resolveKey).toHaveBeenCalledWith(expect.anything(), 'key-1', 'user-1');
  });

  it('refuses a scoped token whose editor key was revoked with 401', async () => {
    mocks.resolveKey.mockResolvedValue({ valid: false, mayRescope: false });
    mocks.payload = { ...mocks.payload, kid: 'key-1' };
    const res = await call('/api/spawn/account');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'Invalid or revoked API key' });
  });

  it('refuses an unknown audience everywhere', async () => {
    mocks.payload = { ...mocks.payload, aud: 'other' };
    expect((await call('/api/spawn/account')).status).toBe(403);
  });

  it('leaves a token without aud unaffected', async () => {
    mocks.payload = { sub: 'user-1', tid: 7, role: 'manager', jti: 'j1' };
    for (const path of ['/api/spawn/membership', '/api/spawn/tokens', '/api/projects']) {
      expect((await call(path)).status).toBe(200);
    }
  });
});
