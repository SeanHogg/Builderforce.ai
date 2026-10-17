/**
 * authMiddleware re-checks tenant membership on every request (through the cached
 * resolver the LLM gateway shares), instead of trusting the JWT's `tid`/`role` for
 * the token's whole lifetime.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  payload: {} as Record<string, unknown>,
  membership: null as null | { isSuperadmin: boolean; role: string | null },
  resolveTenantMembership: vi.fn(),
}));

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
  return { ...actual, resolveTenantMembership: mocks.resolveTenantMembership };
});

import type { HonoEnv } from '../../env';
import { authMiddleware } from './authMiddleware';
import { errorHandler } from './errorHandler';
import { effectiveTenantRole } from '../../application/auth/tenantMembership';
import { TenantRole } from '../../domain/shared/types';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function app() {
  const a = new Hono<HonoEnv>();
  a.onError(errorHandler as never);
  a.get('/api/x', authMiddleware, (c) => c.json({ role: c.get('role'), tenantId: c.get('tenantId') }));
  return a;
}

async function call() {
  return app().request('/api/x', { headers: { Authorization: 'Bearer t' } }, { JWT_SECRET: 's' } as never, ctx);
}

beforeEach(() => {
  mocks.payload = { sub: 'user-1', tid: 7, role: 'manager', jti: 'j1' };
  mocks.resolveTenantMembership.mockReset();
  mocks.resolveTenantMembership.mockImplementation(async () => mocks.membership);
});

describe('authMiddleware tenant membership re-check', () => {
  it('lets a current member through with their token role', async () => {
    mocks.membership = { isSuperadmin: false, role: 'manager' };
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'manager', tenantId: 7 });
    expect(mocks.resolveTenantMembership).toHaveBeenCalledWith(expect.anything(), expect.any(Function), 7, 'user-1');
  });

  it('refuses a removed member with the revoked-session 401', async () => {
    mocks.membership = null;
    const res = await call();
    expect(res.status).toBe(401);
  });

  it('applies a demotion immediately', async () => {
    mocks.membership = { isSuperadmin: false, role: 'viewer' };
    expect(await (await call()).json()).toMatchObject({ role: 'viewer' });
  });

  it('never silently elevates an issued token on promotion', async () => {
    mocks.payload = { ...mocks.payload, role: 'developer' };
    mocks.membership = { isSuperadmin: false, role: 'owner' };
    expect(await (await call()).json()).toMatchObject({ role: 'developer' });
  });

  it('skips the check for machine tokens, which have no membership row', async () => {
    mocks.payload = { sub: 'agentHost:5', tid: 7, role: 'developer', jti: 'j2' };
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.resolveTenantMembership).not.toHaveBeenCalled();
  });

  it('does not consult membership for a token with no workspace', async () => {
    mocks.payload = { sub: 'user-1', tid: null, role: 'developer', jti: 'j3' };
    const res = await call();
    expect(res.status).toBe(401);
    expect(mocks.resolveTenantMembership).not.toHaveBeenCalled();
  });
});

describe('effectiveTenantRole', () => {
  it('takes the lower of token and membership', () => {
    expect(effectiveTenantRole(TenantRole.OWNER, TenantRole.DEVELOPER)).toBe(TenantRole.DEVELOPER);
    expect(effectiveTenantRole(TenantRole.VIEWER, TenantRole.OWNER)).toBe(TenantRole.VIEWER);
    expect(effectiveTenantRole(TenantRole.MANAGER, TenantRole.MANAGER)).toBe(TenantRole.MANAGER);
  });

  it('leaves the token role alone when the membership role is unknown', () => {
    expect(effectiveTenantRole(TenantRole.MANAGER, null)).toBe(TenantRole.MANAGER);
  });
});
