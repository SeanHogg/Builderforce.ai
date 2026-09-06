import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { signHs256 } from '@builderforce/hs256-jwt';
import { requireAuth, type WorkerAuthBindings } from './auth';
import { __clearSessionIntrospectionCacheForTests } from './sessionIntrospection';

/**
 * `requireAuth` end to end: signature + expiry through the shared verifier, then
 * the api's revocation verdict through the shared KV — and every failure mode
 * lands on the side of refusing the request.
 */

const SECRET = 'worker-test-secret';
const FUTURE = 4_000_000_000;
const ACTIVE = { active: true, sub: 'u1', tenantId: 3, jti: 'j1', exp: FUTURE };

function memoryKv() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
    delete: async (k: string) => {
      store.delete(k);
    },
  };
}

function app() {
  const a = new Hono<{ Bindings: WorkerAuthBindings }>();
  a.use('*', requireAuth);
  a.get('/ok', (c) => c.json({ ok: true }));
  return (env: WorkerAuthBindings, authorization?: string) =>
    a.request('http://x/ok', { headers: authorization ? { Authorization: authorization } : {} }, env);
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('requireAuth', () => {
  let request: ReturnType<typeof app>;
  let env: WorkerAuthBindings;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __clearSessionIntrospectionCacheForTests();
    request = app();
    env = { JWT_SECRET: SECRET, AUTH_CACHE_KV: memoryKv(), BUILDERFORCE_API_BASE_URL: 'https://api.test' };
    fetchMock = vi.fn(async () => jsonResponse(200, ACTIVE));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const bearer = async (claims: Record<string, unknown>) => `Bearer ${await signHs256(claims, SECRET)}`;

  it('503s without JWT_SECRET — fail closed, never open', async () => {
    const res = await request({ ...env, JWT_SECRET: undefined }, await bearer({ sub: 'u1', exp: FUTURE }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Server authentication is not configured' });
  });

  it('401s with no bearer at all', async () => {
    expect((await request(env)).status).toBe(401);
  });

  it('401s a bad signature', async () => {
    const forged = `Bearer ${await signHs256({ sub: 'u1', exp: FUTURE, jti: 'j1' }, 'someone-else')}`;
    expect((await request(env, forged)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401s an expired token before asking the api', async () => {
    expect((await request(env, await bearer({ sub: 'u1', exp: 100, jti: 'j1' }))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401s when the api says the session is revoked', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'Session has been revoked' }));
    const res = await request(env, await bearer({ sub: 'u1', exp: FUTURE, jti: 'j1' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('200s an active session, calling the api with the same bearer', async () => {
    const authorization = await bearer({ sub: 'u1', exp: FUTURE, jti: 'j1' });
    const res = await request(env, authorization);
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/auth/introspect');
    expect((init.headers as Record<string, string>).Authorization).toBe(authorization);
  });

  it('serves the second request from the cache without a fetch', async () => {
    const authorization = await bearer({ sub: 'u1', exp: FUTURE, jti: 'j1' });
    expect((await request(env, authorization)).status).toBe(200);
    expect((await request(env, authorization)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('503s when the api is unreachable — an unknown session is not a live one', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const res = await request(env, await bearer({ sub: 'u1', exp: FUTURE, jti: 'j1' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Session check unavailable' });
  });

  it('503s when the api answers with a server error, and does not cache it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(502, { error: 'bad gateway' }));
    const authorization = await bearer({ sub: 'u1', exp: FUTURE, jti: 'j1' });
    expect((await request(env, authorization)).status).toBe(503);
    // The api recovers; the next request must ask again rather than serve the failure.
    expect((await request(env, authorization)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('admits a token without a jti on its signature alone, as the api does for machine tokens', async () => {
    const res = await request(env, await bearer({ sub: 'agentHost:5', exp: FUTURE }));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
