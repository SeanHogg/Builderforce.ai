import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { tenantRoleOf, revokeSessionTokens } = vi.hoisted(() => ({
  tenantRoleOf: vi.fn(),
  revokeSessionTokens: vi.fn(),
}));
vi.mock('../../application/tenant/tenantRoles', () => ({ tenantRoleOf }));
vi.mock('../../application/auth/sessionRevocation', () => ({ revokeSessionTokens }));

import { registerMemberCredentialRevocation } from './memberCredentialRevocationRoutes';

const db = {} as never;

/** The workspace page's scope: its OWN workspace (JWT tenant 5), manager-gated. */
function tenantApp(role = 'manager') {
  const app = new Hono<any>();
  app.use('*', async (c, next) => { c.set('tenantId', 5); await next(); });
  registerMemberCredentialRevocation(app, '/:id/security/users/:userId', {
    dbOf: () => db,
    guard: async (c, next) => (role === 'manager' ? next() : c.json({ error: 'Insufficient role' }, 403)),
    tenantOf: (c) => {
      const id = Number(c.req.param('id'));
      return id === c.get('tenantId') ? id : c.json({ error: 'Forbidden' }, 403);
    },
  });
  return app;
}

/** The superadmin console's scope: any workspace, named by `?tenantId=`. */
function adminApp() {
  const app = new Hono<any>();
  registerMemberCredentialRevocation(app, '/security/users/:userId', {
    dbOf: () => db,
    tenantOf: (c) => {
      const id = Number(c.req.query('tenantId'));
      return Number.isFinite(id) && id > 0 ? id : c.json({ error: 'tenantId is required' }, 400);
    },
  });
  return app;
}

const post = (app: Hono<any>, path: string) => app.request(path, { method: 'POST' });

describe('member credential revocation — one use case, two scopes', () => {
  beforeEach(() => {
    tenantRoleOf.mockReset().mockResolvedValue('developer');
    revokeSessionTokens.mockReset().mockResolvedValue({ revokedJtis: [] });
  });

  it('workspace scope: revokes one session of a member of the caller\'s own workspace', async () => {
    const res = await post(tenantApp(), '/5/security/users/u9/sessions/s1/revoke');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(tenantRoleOf).toHaveBeenCalledWith(db, 5, 'u9');
    expect(revokeSessionTokens).toHaveBeenCalledWith(db, undefined, { userId: 'u9', tenantId: 5, sessionId: 's1' });
  });

  it('workspace scope: refuses another workspace before touching anything (403)', async () => {
    const res = await post(tenantApp(), '/8/security/users/u9/sessions/revoke-all');
    expect(res.status).toBe(403);
    expect(tenantRoleOf).not.toHaveBeenCalled();
    expect(revokeSessionTokens).not.toHaveBeenCalled();
  });

  it('workspace scope: the manager gate still applies', async () => {
    const res = await post(tenantApp('developer'), '/5/security/users/u9/tokens/j1/revoke');
    expect(res.status).toBe(403);
    expect(revokeSessionTokens).not.toHaveBeenCalled();
  });

  it('admin scope: revokes all of a member\'s credentials in the named workspace', async () => {
    const res = await post(adminApp(), '/security/users/u9/sessions/revoke-all?tenantId=12');
    expect(res.status).toBe(200);
    expect(revokeSessionTokens).toHaveBeenCalledWith(db, undefined, { userId: 'u9', tenantId: 12 });
  });

  it('admin scope: one token by jti', async () => {
    await post(adminApp(), '/security/users/u9/tokens/j1/revoke?tenantId=12');
    expect(revokeSessionTokens).toHaveBeenCalledWith(db, undefined, { userId: 'u9', tenantId: 12, jti: 'j1' });
  });

  it('admin scope: requires ?tenantId= (400)', async () => {
    const res = await post(adminApp(), '/security/users/u9/sessions/revoke-all');
    expect(res.status).toBe(400);
    expect(revokeSessionTokens).not.toHaveBeenCalled();
  });

  it('either scope: a person who is not a member of that workspace is a 404, nothing revoked', async () => {
    tenantRoleOf.mockResolvedValue(null);
    for (const res of [
      await post(tenantApp(), '/5/security/users/u9/sessions/revoke-all'),
      await post(adminApp(), '/security/users/u9/sessions/revoke-all?tenantId=12'),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(revokeSessionTokens).not.toHaveBeenCalled();
  });
});
