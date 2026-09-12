import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { UnauthorizedError } from '../../domain/shared/errors';
import { errorHandler } from './errorHandler';
import { optionalTenantId, requireTenantId } from './tenantContext';

/** A context stand-in answering `get('tenantId')` with whatever the auth path left there. */
const ctx = (tenantId: unknown) => ({ get: (_key: 'tenantId') => tenantId });

describe('optionalTenantId', () => {
  it('returns the tenant an auth path published', () => {
    expect(optionalTenantId(ctx(42))).toBe(42);
  });

  it('returns null when no auth path set a tenant (optional auth, web token, guest)', () => {
    expect(optionalTenantId(ctx(undefined))).toBeNull();
    expect(optionalTenantId(ctx(null))).toBeNull();
  });

  it('treats a value no auth path publishes as absent rather than querying with it', () => {
    expect(optionalTenantId(ctx(0))).toBeNull();
    expect(optionalTenantId(ctx(-3))).toBeNull();
    expect(optionalTenantId(ctx(1.5))).toBeNull();
    expect(optionalTenantId(ctx('42'))).toBeNull();
    expect(optionalTenantId(ctx(Number.NaN))).toBeNull();
  });
});

describe('requireTenantId', () => {
  it('returns the tenant when present', () => {
    expect(requireTenantId(ctx(7))).toBe(7);
  });

  it('throws UnauthorizedError when the request has no workspace', () => {
    expect(() => requireTenantId(ctx(undefined))).toThrow(UnauthorizedError);
  });

  it('surfaces as a 401 through the shared error handler', async () => {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.get('/scoped', (c) => c.json({ tenantId: requireTenantId(c) }));

    // The error handler stamps CORS headers, which reads `env` — give it one.
    const res = await app.request('/scoped', {}, { CORS_ORIGINS: '' } as never);
    expect(res.status).toBe(401);
  });

  it('accepts a real Hono context without a cast', async () => {
    const app = new Hono<HonoEnv>();
    app.use('*', async (c, next) => { c.set('tenantId', 11); await next(); });
    app.get('/scoped', (c) => c.json({ tenantId: requireTenantId(c), optional: optionalTenantId(c) }));

    const res = await app.request('/scoped');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenantId: 11, optional: 11 });
  });
});
