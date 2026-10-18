/**
 * forwardToCanonical: a legacy path on one router runs the canonical route on
 * another — same handler, same middleware, same body — and says it is deprecated.
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { forwardToCanonical } from './legacyAlias';

function app(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  // Middleware on the canonical prefix must run for the alias too (rate limit, auth).
  a.use('/api/*', async (c, next) => { await next(); c.header('X-Canonical-Chain', 'yes'); });
  a.post('/api/auth/web/login', async (c) => {
    const body = await c.req.json<{ email: string }>();
    return c.json({ signedIn: body.email, query: c.req.query('next') ?? null }, 201);
  });
  a.post('/marketplace/auth/login', forwardToCanonical(a, '/api/auth/web/login'));
  return a;
}

describe('forwardToCanonical', () => {
  it('runs the canonical route with the original body, status and query', async () => {
    const res = await app().request('/marketplace/auth/login?next=%2Fshop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.test' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ signedIn: 'a@b.test', query: '/shop' });
    expect(res.headers.get('X-Canonical-Chain')).toBe('yes');
  });

  it('stamps the deprecation headers naming the successor', async () => {
    const res = await app().request('/marketplace/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@y.test' }),
    });
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toBe('</api/auth/web/login>; rel="successor-version"');
  });
});
