/**
 * GET/POST /api/tenants are THE "my workspaces" list and create; /mine and
 * /create are legacy aliases over the same handlers, announcing their successor.
 */
import { describe, expect, it, vi } from 'vitest';

const uc = vi.hoisted(() => ({
  listMyWorkspaces: vi.fn(async (..._args: unknown[]) => ({ defaultTenantId: 3, tenants: [{ id: 3, name: 'Hogg' }] })),
  createWorkspace: vi.fn(async (_db: unknown, _ts: unknown, input: { name: string }) => (
    input.name?.trim() ? { ok: true, tenant: { toPlain: () => ({ id: 9, name: input.name.trim() }) } } : { ok: false, error: 'name_required' }
  )),
}));
vi.mock('../../application/tenant/myWorkspaces', () => uc);
// Which middleware authenticated the request is what the canonical path is about.
vi.mock('../middleware/personAuthMiddleware', () => ({
  personAuthMiddleware: async (c: any, next: any) => { c.set('userId', 'person'); await next(); },
}));
vi.mock('../middleware/webAuthMiddleware', () => ({
  webAuthMiddleware: async (c: any, next: any) => { c.set('userId', 'web'); await next(); },
}));
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (_c: any, _next: any) => new Response('workspace token required', { status: 401 }),
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { createTenantRoutes } from './tenantRoutes';

const routes = () => createTenantRoutes({} as never, {} as never);
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('tenantRoutes — the one "my workspaces" surface', () => {
  it('GET / is person-level (not behind the workspace-token wall) and returns the shared contract', async () => {
    const res = await routes().request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ defaultTenantId: 3, tenants: [{ id: 3, name: 'Hogg' }] });
    expect(uc.listMyWorkspaces.mock.calls.at(-1)?.[3]).toBe('person');
    expect(res.headers.get('Deprecation')).toBeNull();
  });

  it('POST / creates the workspace (201) and refuses a blank name (400)', async () => {
    const ok = await routes().request('/', post({ name: ' Team ' }));
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ id: 9, name: 'Team' });
    const blank = await routes().request('/', post({ name: '  ' }));
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: 'name is required' });
  });

  it('GET /mine and POST /create are aliases: same handlers, web-token auth, successor header', async () => {
    const mine = await routes().request('/mine');
    expect(mine.status).toBe(200);
    expect(uc.listMyWorkspaces.mock.calls.at(-1)?.[3]).toBe('web');
    expect(mine.headers.get('Deprecation')).toBe('true');
    expect(mine.headers.get('Link')).toBe('</api/tenants>; rel="successor-version"');

    const created = await routes().request('/create', post({ name: 'Team' }));
    expect(created.status).toBe(201);
    expect(created.headers.get('Link')).toBe('</api/tenants>; rel="successor-version"');
  });
});
