import { describe, expect, it, vi, beforeEach } from 'vitest';

const USER = 'user-abc';
const TENANT = 5;

// authMiddleware injects the signed-in user/tenant (mirrors a valid editor JWT).
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', USER);
    c.set('tenantId', TENANT);
    c.set('role', 'developer');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

// Token minting is exercised by its own unit; here we only assert it is called with the
// switched tenant + the JWT's user, and that the route returns its result. vi.hoisted so
// the mock fn exists before vi.mock's hoisted factory runs.
const { mintTenantSessionToken } = vi.hoisted(() => ({ mintTenantSessionToken: vi.fn() }));
vi.mock('../../infrastructure/auth/tenantSessionToken', () => ({ mintTenantSessionToken }));

import { createVscodeRoutes } from './vscodeRoutes';

const WORKSPACES = [
  { id: TENANT, name: 'Acme', slug: 'acme', role: 'owner', status: 'active' },
  { id: 8, name: 'Side Project', slug: 'side', role: 'developer', status: 'active' },
];

function makeTenantService() {
  return {
    listTenantsForUser: vi.fn(async (_userId: string) => WORKSPACES),
    createTenant: vi.fn(async (opts: { name: string; ownerUserId: string }) => ({
      toPlain: () => ({ id: 42, name: opts.name, slug: 'new', ownerUserId: opts.ownerUserId }),
    })),
  };
}

const ENV = { JWT_SECRET: 'test-secret' } as any;
const postJson = (body?: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('vscodeRoutes — workspace (tenant) management', () => {
  beforeEach(() => {
    mintTenantSessionToken.mockReset();
    mintTenantSessionToken.mockResolvedValue({ token: 'minted.jwt', expiresIn: 3600 });
  });

  it('GET /tenants lists the signed-in user\'s workspaces', async () => {
    const ts = makeTenantService();
    const res = await createVscodeRoutes({} as any, ts as any).request('/tenants', undefined, ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenants: WORKSPACES });
    expect(ts.listTenantsForUser).toHaveBeenCalledWith(USER);
  });

  it('POST /tenants creates a workspace owned by the caller (201)', async () => {
    const ts = makeTenantService();
    const res = await createVscodeRoutes({} as any, ts as any).request('/tenants', postJson({ name: '  My Team  ' }), ENV);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 42, name: 'My Team' });
    expect(ts.createTenant).toHaveBeenCalledWith({ name: 'My Team', ownerUserId: USER });
  });

  it('POST /tenants rejects a blank name (400)', async () => {
    const ts = makeTenantService();
    const res = await createVscodeRoutes({} as any, ts as any).request('/tenants', postJson({ name: '   ' }), ENV);
    expect(res.status).toBe(400);
    expect(ts.createTenant).not.toHaveBeenCalled();
  });

  it('POST /tenants/:id/token mints a re-scoped token for a workspace the user belongs to', async () => {
    const ts = makeTenantService();
    const res = await createVscodeRoutes({} as any, ts as any).request('/tenants/8/token', postJson(), ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 'minted.jwt', expiresIn: 3600, tenantId: 8 });
    expect(mintTenantSessionToken).toHaveBeenCalledTimes(1);
    const [, secret, opts] = mintTenantSessionToken.mock.calls[0] as any[];
    expect(secret).toBe('test-secret');
    expect(opts).toMatchObject({ userId: USER, tenantId: 8 });
  });

  it('POST /tenants/:id/token refuses a workspace the user is NOT a member of (403)', async () => {
    const ts = makeTenantService();
    const res = await createVscodeRoutes({} as any, ts as any).request('/tenants/999/token', postJson(), ENV);
    expect(res.status).toBe(403);
    expect(mintTenantSessionToken).not.toHaveBeenCalled();
  });

  it('POST /tenants/:id/token rejects an invalid tenant id (400)', async () => {
    const ts = makeTenantService();
    const res = await createVscodeRoutes({} as any, ts as any).request('/tenants/0/token', postJson(), ENV);
    expect(res.status).toBe(400);
    expect(ts.listTenantsForUser).not.toHaveBeenCalled();
    expect(mintTenantSessionToken).not.toHaveBeenCalled();
  });
});
