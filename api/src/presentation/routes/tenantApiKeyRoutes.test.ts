import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const svc = vi.hoisted(() => ({
  mintTenantApiKey: vi.fn(),
  listTenantApiKeys: vi.fn(),
  queryTenantApiKeyUsage: vi.fn(),
  revokeTenantApiKey: vi.fn(),
  updateTenantApiKey: vi.fn(),
  isTenantApiScope: (s: string) => s === 'replay:ingest',
}));
const gates = vi.hoisted(() => ({ role: 'owner', permissionChecks: [] as string[] }));
vi.mock('../../application/llm/tenantApiKeyService', () => svc);
// The owner scope's JWT: user u1 in workspace 5.
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('userId', 'u1'); c.set('tenantId', 5); await next(); },
  requireRole: () => async (c: any, next: any) => (gates.role === 'owner' ? next() : c.json({ error: 'Insufficient role' }, 403)),
}));
vi.mock('../middleware/requirePermission', () => ({
  requirePermission: (p: string) => async (_c: any, next: any) => { gates.permissionChecks.push(p); await next(); },
}));
vi.mock('../../application/shared/dbHandle', () => ({ requestDb: () => 'request-db' }));

import { createPlatformTenantApiKeyRoutes, createTenantApiKeyRoutes } from './tenantApiKeyRoutes';

function ownerApp() {
  const app = new Hono<any>();
  app.route('/api/tenants/:tenantId/api-keys', createTenantApiKeyRoutes('owner-db' as never));
  return app;
}
/** Mounted as adminRoutes mounts it; the superadmin gate is the parent's job. */
function adminApp() {
  const app = new Hono<any>();
  app.use('*', async (c, next) => { c.set('userId', 'admin-1'); await next(); });
  app.route('/api/admin/tenants/:tenantId/api-keys', createPlatformTenantApiKeyRoutes());
  return app;
}
const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe('tenant API keys — one router, owner and platform-admin scopes', () => {
  beforeEach(() => {
    gates.role = 'owner';
    gates.permissionChecks = [];
    for (const fn of Object.values(svc)) if (typeof fn === 'function' && 'mockReset' in fn) (fn as any).mockReset();
    svc.mintTenantApiKey.mockResolvedValue({ id: 'k1', key: 'bfk_x' });
    svc.listTenantApiKeys.mockResolvedValue([{ id: 'k1' }]);
    svc.revokeTenantApiKey.mockResolvedValue(true);
  });

  it('owner: mints in the JWT workspace with scopes filtered and the permission checked', async () => {
    const res = await ownerApp().request('/api/tenants/5/api-keys', json('POST', { name: ' CI ', scopes: ['replay:ingest', 'bogus'] }));
    expect(res.status).toBe(201);
    expect(svc.mintTenantApiKey).toHaveBeenCalledWith('owner-db', {
      tenantId: 5, name: 'CI', createdByUserId: 'u1', allowedOrigins: null, scopes: ['replay:ingest'],
    });
    expect(gates.permissionChecks).toContain('apikey:rotate');
  });

  it('owner: another workspace in the URL is refused (403)', async () => {
    const res = await ownerApp().request('/api/tenants/8/api-keys', json('GET'));
    expect(res.status).toBe(403);
    expect(svc.listTenantApiKeys).not.toHaveBeenCalled();
  });

  it('owner: a non-owner is refused (403)', async () => {
    gates.role = 'manager';
    const res = await ownerApp().request('/api/tenants/5/api-keys', json('GET'));
    expect(res.status).toBe(403);
  });

  it('admin: lists ANY workspace named in the URL, no member permissions applied', async () => {
    const res = await adminApp().request('/api/admin/tenants/8/api-keys', json('GET'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ keys: [{ id: 'k1' }] });
    expect(svc.listTenantApiKeys).toHaveBeenCalledWith('request-db', 8);
    expect(gates.permissionChecks).toEqual([]);
  });

  it('admin: mints a full-tenant key (no scopes) with the admin default name, body optional', async () => {
    const res = await adminApp().request('/api/admin/tenants/8/api-keys', { method: 'POST' });
    expect(res.status).toBe(201);
    expect(svc.mintTenantApiKey).toHaveBeenCalledWith('request-db', {
      tenantId: 8, name: 'Admin-issued tenant API key', createdByUserId: 'admin-1', allowedOrigins: null,
    });
  });

  it('admin: rejects a non-numeric tenant id (400)', async () => {
    const res = await adminApp().request('/api/admin/tenants/abc/api-keys/k1', json('DELETE'));
    expect(res.status).toBe(400);
    expect(svc.revokeTenantApiKey).not.toHaveBeenCalled();
  });

  it('both: revoke answers 404 for an unknown key', async () => {
    svc.revokeTenantApiKey.mockResolvedValue(false);
    expect((await ownerApp().request('/api/tenants/5/api-keys/nope', json('DELETE'))).status).toBe(404);
    expect((await adminApp().request('/api/admin/tenants/8/api-keys/nope', json('DELETE'))).status).toBe(404);
  });
});
