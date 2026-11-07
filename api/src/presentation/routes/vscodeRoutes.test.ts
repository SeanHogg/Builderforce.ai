import { describe, expect, it, vi, beforeEach } from 'vitest';

const USER = 'user-abc';
const TENANT = 5;

// What the JWT carries beyond user/tenant: a key-derived editor session has the device
// `src` surface and the `kid` of its key; a web session has neither (the default).
const session = vi.hoisted(() => ({ surface: undefined as string | undefined, keyId: undefined as string | undefined }));

// authMiddleware injects the signed-in user/tenant (mirrors a valid editor JWT).
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', USER);
    c.set('tenantId', TENANT);
    c.set('role', 'developer');
    if (session.surface) c.set('clientSurface', session.surface);
    if (session.keyId) c.set('apiKeyId', session.keyId);
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

/** A chainable drizzle-select stub whose terminal `.limit()` resolves to `rows`. */
function makeDb(rows: unknown[]) {
  const qb: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'innerJoin', 'leftJoin', 'where', 'orderBy']) qb[m] = () => qb;
  qb.limit = () => Promise.resolve(rows);
  return qb;
}

const ENV = { JWT_SECRET: 'test-secret' } as any;
const postJson = (body?: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('vscodeRoutes — workspace (tenant) management', () => {
  beforeEach(() => {
    session.surface = undefined;
    session.keyId = undefined;
    mintTenantSessionToken.mockReset();
    mintTenantSessionToken.mockResolvedValue({ token: 'minted.jwt', expiresIn: 3600 });
  });

  it('GET /tenants lists the signed-in user\'s workspaces', async () => {
    const ts = makeTenantService();
    // A real `db`, not `{}`: the handler lands any pending invitation BEFORE listing
    // (so a teammate invited by email sees the workspace on their first look), and
    // that read goes to the database. With an empty stub it threw `db.select is not a
    // function` and the route answered 500 — the endpoint was never actually asserted.
    const res = await createVscodeRoutes(makeDb([]) as any, ts as any).request('/tenants', undefined, ENV);
    expect(res.status).toBe(200);
    // The shared "my workspaces" contract: the account default rides along (null here —
    // the stub db has no stored default).
    expect(await res.json()).toEqual({ defaultTenantId: null, tenants: WORKSPACES });
    expect(ts.listTenantsForUser).toHaveBeenCalledWith(USER);
    // Legacy alias of GET /api/tenants — announces its successor.
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toBe('</api/tenants>; rel="successor-version"');
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
    expect(opts).toMatchObject({ userId: USER, tenantId: 8, clientSurface: 'vscode' });
  });

  describe('POST /tenants/:id/token for a key-derived editor session', () => {
    const keyRow = (over: Record<string, unknown> = {}) => ({
      revokedAt: null, createdByUserId: USER, client: 'vscode', scopes: null, allowedOrigins: null, ...over,
    });
    const rescope = (rows: unknown[]) => {
      session.surface = 'vscode';
      session.keyId = 'key-1';
      return createVscodeRoutes(makeDb(rows) as any, makeTenantService() as any).request('/tenants/8/token', postJson(), ENV);
    };

    it('allows a device key whose creator is a member, and carries the key forward as kid', async () => {
      const res = await rescope([keyRow()]);
      expect(res.status).toBe(200);
      expect(mintTenantSessionToken.mock.calls[0]![2]).toMatchObject({ tenantId: 8, keyId: 'key-1' });
    });

    it.each([
      ['non-device', { client: null }],
      ['scoped', { scopes: JSON.stringify(['recordings:write']) }],
      ['origin-allowlisted', { allowedOrigins: JSON.stringify(['https://app.example.com']) }],
    ])('refuses a %s key with editor_key_required', async (_name, over) => {
      const res = await rescope([keyRow(over)]);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'editor_key_required' });
      expect(mintTenantSessionToken).not.toHaveBeenCalled();
    });

    it.each([
      ['revoked', [keyRow({ revokedAt: new Date('2026-01-01') })]],
      ["someone else's", [keyRow({ createdByUserId: 'user-other' })]],
      ['unknown (the kid matches no key row)', []],
    ])('answers 401 for a %s key, so the editor re-checks its key', async (_name, rows) => {
      const res = await rescope(rows as unknown[]);
      expect(res.status).toBe(401);
      expect(mintTenantSessionToken).not.toHaveBeenCalled();
    });

    it("a revoked key cannot keep renewing a token in the session's own workspace either", async () => {
      session.surface = 'vscode';
      session.keyId = 'key-1';
      const res = await createVscodeRoutes(makeDb([keyRow({ revokedAt: new Date('2026-01-01') })]) as any, makeTenantService() as any)
        .request(`/tenants/${TENANT}/token`, postJson(), ENV);
      expect(res.status).toBe(401);
    });

    it('a cross-workspace switch from a token with no kid is session_stale (not a verdict on the key)', async () => {
      session.surface = 'vscode';
      const res = await createVscodeRoutes(makeDb([keyRow()]) as any, makeTenantService() as any).request('/tenants/8/token', postJson(), ENV);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'session_stale' });
    });

    it("a legacy token with no kid is session_stale even for its own workspace (it must not self-renew)", async () => {
      session.surface = 'vscode';
      const res = await createVscodeRoutes(makeDb([]) as any, makeTenantService() as any).request(`/tenants/${TENANT}/token`, postJson(), ENV);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'session_stale' });
      expect(mintTenantSessionToken).not.toHaveBeenCalled();
    });
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

  it('GET /tasks returns the open tasks assigned to the signed-in user', async () => {
    const rows = [
      { id: 1, key: 'ACME-1', title: 'Fix bug', status: 'todo', priority: 'high', projectId: 3, projectPublicId: 'pub-3', projectName: 'Acme', githubPrUrl: null, updatedAt: '2026-07-05T00:00:00.000Z' },
    ];
    const res = await createVscodeRoutes(makeDb(rows) as any, makeTenantService() as any).request('/tasks', undefined, ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tasks: rows });
  });

  it('GET /tasks returns an empty list when nothing is assigned', async () => {
    const res = await createVscodeRoutes(makeDb([]) as any, makeTenantService() as any).request('/tasks', undefined, ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tasks: [] });
  });
});
