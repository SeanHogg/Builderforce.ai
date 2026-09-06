import { describe, expect, it, vi } from 'vitest';
import { signHs256 } from '@builderforce/hs256-jwt';

/**
 * The middleware is the verdict: this test stands in for it with a stub that
 * either admits the caller (publishing the same context variables the real
 * `authMiddleware` sets) or refuses with the real middleware's 401 shape.
 */
let admit: { userId: string; tenantId?: number; tokenJti?: string } | null = null;

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    if (!admit) return c.json({ error: 'Token has been revoked or expired' }, 401);
    c.set('userId', admit.userId);
    if (admit.tenantId !== undefined) c.set('tenantId', admit.tenantId);
    if (admit.tokenJti) c.set('tokenJti', admit.tokenJti);
    await next();
  },
}));

const { createSessionIntrospectRoutes } = await import('./sessionIntrospectRoutes');

const SECRET = 'introspect-test-secret';
const EXP = 4_000_000_000;

async function bearer(claims: Record<string, unknown>) {
  return `Bearer ${await signHs256({ exp: EXP, ...claims }, SECRET)}`;
}

describe('GET /introspect', () => {
  it('describes an admitted token: sub, tenant, jti and exp', async () => {
    admit = { userId: 'u1', tenantId: 42, tokenJti: 'jti-1' };
    const res = await createSessionIntrospectRoutes().request('/introspect', {
      headers: { Authorization: await bearer({ sub: 'u1', tid: 42, jti: 'jti-1' }) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active: true, sub: 'u1', tenantId: 42, jti: 'jti-1', exp: EXP });
  });

  it('reads the token from ?token= when there is no header, like the middleware', async () => {
    admit = { userId: 'u1', tenantId: 42, tokenJti: 'jti-2' };
    const token = await signHs256({ exp: EXP, sub: 'u1', jti: 'jti-2' }, SECRET);
    const res = await createSessionIntrospectRoutes().request(`/introspect?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { exp: number }).exp).toBe(EXP);
  });

  it('never reaches the handler for a revoked token — the middleware answers 401', async () => {
    admit = null;
    const res = await createSessionIntrospectRoutes().request('/introspect', {
      headers: { Authorization: await bearer({ sub: 'u1', jti: 'jti-3' }) },
    });
    expect(res.status).toBe(401);
  });

  it('refuses to introspect a token with no jti (a machine token) rather than invent a verdict', async () => {
    admit = { userId: 'agentHost:5', tenantId: 42 };
    const res = await createSessionIntrospectRoutes().request('/introspect', {
      headers: { Authorization: await bearer({ sub: 'agentHost:5' }) },
    });
    expect(res.status).toBe(400);
  });
});
