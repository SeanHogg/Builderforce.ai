/** POST /api/auth/scoped-token: needs auth, rejects an unknown audience, mints a 15-minute aud token. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  authed: true,
  extra: {} as Record<string, unknown>,
  mint: vi.fn(async () => ({ token: 'scoped.jwt', expiresIn: 900 })),
  resolveKey: vi.fn(async () => ({ valid: true, mayRescope: false })),
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: { set: (k: string, v: unknown) => void; json: (b: unknown, s: number) => Response }, next: () => Promise<void>) => {
    if (!mocks.authed) return c.json({ error: 'Missing or malformed Authorization header' }, 401);
    c.set('userId', 'user-1');
    c.set('tenantId', 7);
    c.set('role', 'manager');
    for (const [k, v] of Object.entries(mocks.extra)) c.set(k, v);
    await next();
  },
}));
vi.mock('../../infrastructure/auth/tenantSessionToken', () => ({ mintTenantSessionToken: mocks.mint }));
vi.mock('../../application/llm/gatewayAccess', () => ({ resolveEditorKeySession: mocks.resolveKey }));

import type { HonoEnv } from '../../env';
import { createScopedTokenRoute } from './scopedTokenRoute';

function post(body: unknown) {
  const app = new Hono<HonoEnv>();
  app.route('/api/auth', createScopedTokenRoute({} as never));
  return app.request(
    '/api/auth/scoped-token',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    { JWT_SECRET: 's' } as never,
  );
}

beforeEach(() => {
  mocks.authed = true;
  mocks.extra = {};
  mocks.mint.mockClear();
  mocks.resolveKey.mockReset();
  mocks.resolveKey.mockResolvedValue({ valid: true, mayRescope: false });
});

describe('POST /api/auth/scoped-token', () => {
  it('requires authentication', async () => {
    mocks.authed = false;
    expect((await post({ audience: 'spawn' })).status).toBe(401);
    expect(mocks.mint).not.toHaveBeenCalled();
  });

  it('rejects an unknown audience', async () => {
    expect((await post({ audience: 'admin' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(mocks.mint).not.toHaveBeenCalled();
  });

  it('mints a 15-minute spawn token for the caller', async () => {
    const res = await post({ audience: 'spawn' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: string };
    expect(body.token).toBe('scoped.jwt');
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(mocks.mint).toHaveBeenCalledWith(
      expect.anything(),
      's',
      expect.objectContaining({ userId: 'user-1', tenantId: 7, audience: 'spawn', expiresIn: 900 }),
    );
    expect(mocks.resolveKey).not.toHaveBeenCalled();
  });

  it('refuses to mint when the caller token is itself audience-bound', async () => {
    mocks.extra = { tokenAudience: 'spawn' };
    const res = await post({ audience: 'spawn' });
    expect(res.status).toBe(403);
    expect(mocks.mint).not.toHaveBeenCalled();
  });

  it.each([
    ['a machine actor', { machineActor: { kind: 'agentHost', agentHostId: 5 } }],
    ['a cloud agent replay', { agentActorRef: 'agent-1' }],
    ['an emulation context', { isEmulation: true }],
  ])('refuses to mint for %s', async (_label, extra) => {
    mocks.extra = extra;
    expect((await post({ audience: 'spawn' })).status).toBe(403);
    expect(mocks.mint).not.toHaveBeenCalled();
  });

  it('refuses to mint from a revoked editor key', async () => {
    mocks.extra = { apiKeyId: 'key-1' };
    mocks.resolveKey.mockResolvedValue({ valid: false, mayRescope: false });
    const res = await post({ audience: 'spawn' });
    expect(res.status).toBe(401);
    expect(mocks.resolveKey).toHaveBeenCalledWith(expect.anything(), 'key-1', 'user-1');
    expect(mocks.mint).not.toHaveBeenCalled();
  });

  it('mints from a live editor key and carries the key id', async () => {
    mocks.extra = { apiKeyId: 'key-1' };
    expect((await post({ audience: 'spawn' })).status).toBe(200);
    expect(mocks.mint).toHaveBeenCalledWith(expect.anything(), 's', expect.objectContaining({ keyId: 'key-1' }));
  });

  it('links the minted token to the parent session so revoking it revokes the token', async () => {
    mocks.extra = { sessionId: 'sess-1' };
    expect((await post({ audience: 'spawn' })).status).toBe(200);
    expect(mocks.mint).toHaveBeenCalledWith(expect.anything(), 's', expect.objectContaining({ sessionId: 'sess-1' }));
  });
});
