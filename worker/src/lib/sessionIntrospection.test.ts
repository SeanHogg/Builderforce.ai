import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __clearSessionIntrospectionCacheForTests,
  introspectSession,
  SessionIntrospectionUnavailableError,
  type SessionIntrospectionEnv,
} from './sessionIntrospection';

/**
 * The worker's side of the revocation contract: one api call per jti, the
 * verdict cached in the api's KV under the key the api's revoke path deletes,
 * refusals cached too, and an api that cannot answer NEVER cached.
 */

function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null)),
    put: vi.fn(async (k: string, v: string, _options?: { expirationTtl?: number }) => {
      store.set(k, v);
    }),
    delete: vi.fn(async (k: string) => {
      store.delete(k);
    }),
  };
}

const ACTIVE = { active: true, sub: 'u1', tenantId: 3, jti: 'j1', exp: 4_000_000_000 };
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('introspectSession', () => {
  let kv: ReturnType<typeof memoryKv>;
  let env: SessionIntrospectionEnv;

  beforeEach(() => {
    __clearSessionIntrospectionCacheForTests();
    kv = memoryKv();
    env = { AUTH_CACHE_KV: kv, BUILDERFORCE_API_BASE_URL: 'https://api.test/' };
  });

  it('GETs the introspect path with the bearer and caches an active verdict under the jti key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, ACTIVE));
    const verdict = await introspectSession(env, 'tok', 'j1', fetchImpl as unknown as typeof fetch);
    expect(verdict).toEqual(ACTIVE);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/auth/introspect');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(kv.store.has('cache:auth:introspect:j1')).toBe(true);
    expect(kv.put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 60 });
  });

  it('serves the second call from cache without another fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, ACTIVE));
    await introspectSession(env, 'tok', 'j1', fetchImpl as unknown as typeof fetch);
    await introspectSession(env, 'tok', 'j1', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('serves a verdict another isolate cached in KV without a fetch', async () => {
    kv.store.set('cache:auth:introspect:j1', JSON.stringify(ACTIVE));
    const fetchImpl = vi.fn();
    expect(await introspectSession(env, 'tok', 'j1', fetchImpl as unknown as typeof fetch)).toEqual(ACTIVE);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('re-asks the api once the revoke path has deleted the KV key and the L1 is gone', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, ACTIVE))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Token has been revoked or expired' }));
    await introspectSession(env, 'tok', 'j1', fetchImpl as unknown as typeof fetch);
    // What the api's `revokeSessionTokens` does to the shared namespace…
    kv.store.delete('cache:auth:introspect:j1');
    // …and what the L1 TTL does, eventually.
    __clearSessionIntrospectionCacheForTests();
    expect(await introspectSession(env, 'tok', 'j1', fetchImpl as unknown as typeof fetch)).toEqual({ active: false, reason: 'revoked' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('caches a %i as revoked — a revoked token stays revoked', async (status) => {
    const fetchImpl = vi.fn(async () => jsonResponse(status, { error: 'nope' }));
    expect(await introspectSession(env, 'tok', 'j2', fetchImpl as unknown as typeof fetch)).toEqual({ active: false, reason: 'revoked' });
    expect(JSON.parse(kv.store.get('cache:auth:introspect:j2')!)).toEqual({ active: false, reason: 'revoked' });
    await introspectSession(env, 'tok', 'j2', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([500, 502, 404])('throws on a %i and caches nothing', async (status) => {
    const fetchImpl = vi.fn(async () => jsonResponse(status, { error: 'down' }));
    await expect(introspectSession(env, 'tok', 'j3', fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(SessionIntrospectionUnavailableError);
    expect(kv.store.size).toBe(0);
    await expect(introspectSession(env, 'tok', 'j3', fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(SessionIntrospectionUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws on a network failure and caches nothing', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(introspectSession(env, 'tok', 'j4', fetchImpl as unknown as typeof fetch)).rejects.toThrow(/fetch failed/);
    expect(kv.store.size).toBe(0);
  });

  it('throws on a 200 whose body is not an active verdict', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { hello: 'world' }));
    await expect(introspectSession(env, 'tok', 'j5', fetchImpl as unknown as typeof fetch)).rejects.toThrow(/unrecognised verdict/);
    expect(kv.store.size).toBe(0);
  });

  it('works without a KV binding — L1 only, still one fetch per isolate', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, ACTIVE));
    const noKv: SessionIntrospectionEnv = { BUILDERFORCE_API_BASE_URL: 'https://api.test' };
    await introspectSession(noKv, 'tok', 'j6', fetchImpl as unknown as typeof fetch);
    await introspectSession(noKv, 'tok', 'j6', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
