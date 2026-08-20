/**
 * The dual-auth door. Four route files each open-coded this fallback and
 * disagreed on which key conventions counted, so these pin the behaviour that
 * replaced them:
 *
 *   - a host key authenticates in ALL THREE conventions and lands the SAME
 *     request identity the host's JWT-exchange door mints (machine actor,
 *     DEVELOPER role, `agentHost:<id>` subject), so a handler cannot tell the
 *     doors apart;
 *   - no host key falls through to the human path verbatim; and
 *   - a bad host key does NOT fall through — silently degrading a wrong key into
 *     "anonymous" is how a 401 turns into a confusing 200 on the JWT branch.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const authMiddleware = vi.fn(async (c: any, next: any) => {
  c.set('tenantId', 900);
  c.set('userId', 'user-1');
  c.set('role', 'manager');
  await next();
});
vi.mock('./authMiddleware', () => ({ authMiddleware: (c: any, n: any) => authMiddleware(c, n) }));
vi.mock('../../infrastructure/auth/segmentResolver', () => ({
  resolveSegment: async () => 'seg-default',
}));

import { hostOrTenantAuth, requestAgentHostId } from './hostOrTenantAuth';

/** A db stub whose agent_hosts row is host 7 / tenant 42 with key 'good'. */
const db = {
  select: () => ({
    from: () => ({
      where: (..._a: unknown[]) => Promise.resolve([
        { id: 7, tenantId: 42, apiKeyHash: 'HASH:good', status: 'active' },
      ]),
    }),
  }),
} as never;

vi.mock('../../infrastructure/auth/HashService', () => ({
  verifySecret: async (value: string, stored: string) => stored === `HASH:${value}`,
}));

interface Probe {
  tenantId?: number;
  userId?: string;
  role?: string;
  segmentId?: string;
  agentHostId: number | null;
}
const readProbe = (res: Response): Promise<Probe> => res.json() as Promise<Probe>;

const probe = (c: any) =>
  c.json({
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
    role: c.get('role'),
    segmentId: c.get('segmentId'),
    agentHostId: requestAgentHostId(c),
  });

/**
 * `idPathParam` is registered PER ROUTE, the way the real callers register it: a
 * wildcard `use('*')` runs before Hono has matched a route, so there would be no
 * path parameters for the middleware to read.
 */
function app(idPathParam?: string) {
  const router = new Hono();
  if (idPathParam) {
    router.get('/:id/probe', hostOrTenantAuth(db, idPathParam) as never, probe);
    router.get('/probe', hostOrTenantAuth(db, idPathParam) as never, probe);
    return router;
  }
  router.use('*', hostOrTenantAuth(db) as never);
  router.get('/probe', probe);
  router.get('/:id/probe', probe);
  return router;
}

describe('hostOrTenantAuth', () => {
  it('authenticates Bearer + X-AgentHost-Id as the host, with the machine identity', async () => {
    const res = await app().request('/probe', {
      headers: { Authorization: 'Bearer good', 'X-AgentHost-Id': '7' },
    });
    expect(res.status).toBe(200);
    expect(await readProbe(res)).toEqual({
      tenantId: 42,
      userId: 'agentHost:7',
      role: 'developer',
      segmentId: 'seg-default',
      agentHostId: 7,
    });
    expect(authMiddleware).not.toHaveBeenCalled();
  });

  it('authenticates the ?agentHostId=&key= convention', async () => {
    const res = await app().request('/probe?agentHostId=7&key=good');
    expect((await readProbe(res)).agentHostId).toBe(7);
  });

  it('authenticates a bare Bearer key when the id is in the route path', async () => {
    const res = await app('id').request('/7/probe', { headers: { Authorization: 'Bearer good' } });
    expect((await readProbe(res)).agentHostId).toBe(7);
  });

  it('does NOT read the path id unless the route opts in', async () => {
    const res = await app().request('/7/probe', { headers: { Authorization: 'Bearer good' } });
    // Falls through to the human path — a bare Bearer is a JWT to everyone else.
    expect((await readProbe(res)).agentHostId).toBeNull();
  });

  it('falls through to the tenant-JWT path when no host key resolves', async () => {
    const res = await app().request('/probe', { headers: { Authorization: 'Bearer a.jwt.token' } });
    expect(await readProbe(res)).toMatchObject({ tenantId: 900, userId: 'user-1', agentHostId: null });
  });

  it('does not accept a wrong key as a host', async () => {
    const res = await app().request('/probe?agentHostId=7&key=wrong');
    expect((await readProbe(res)).agentHostId).toBeNull();
  });
});
