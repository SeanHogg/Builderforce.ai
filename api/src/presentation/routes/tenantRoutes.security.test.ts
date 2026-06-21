import { describe, expect, it, vi } from 'vitest';

const CALLER_TENANT = 5;

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'user-abc');
    c.set('tenantId', CALLER_TENANT);
    c.set('role', 'developer');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));
vi.mock('../middleware/webAuthMiddleware', () => ({
  webAuthMiddleware: async (_c: any, next: any) => next(),
}));

import { createTenantRoutes } from './tenantRoutes';

function makeTenantService() {
  return {
    getTenant: vi.fn(async (id: number) => ({
      toPlain: () => ({ id, name: 'Acme', plan: 'pro' }),
      defaultAgentHostId: 7,
    })),
  };
}

const routes = (ts: ReturnType<typeof makeTenantService>) =>
  createTenantRoutes(ts as any, {} as any);

describe('tenantRoutes — GET /:id is self-scoped (cross-tenant read blocked)', () => {
  it('returns the tenant when the caller reads its OWN workspace', async () => {
    const ts = makeTenantService();
    const res = await routes(ts).request(`/${CALLER_TENANT}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: CALLER_TENANT, name: 'Acme' });
  });

  it('403s when reading ANOTHER tenant by id, without touching the service', async () => {
    const ts = makeTenantService();
    const res = await routes(ts).request('/999');
    expect(res.status).toBe(403);
    expect(ts.getTenant).not.toHaveBeenCalled();
  });

  it('applies the same self-scope guard to /:id/default-agentHost', async () => {
    const ts = makeTenantService();
    expect((await routes(ts).request(`/${CALLER_TENANT}/default-agentHost`)).status).toBe(200);
    const cross = await routes(ts).request('/999/default-agentHost');
    expect(cross.status).toBe(403);
  });
});
