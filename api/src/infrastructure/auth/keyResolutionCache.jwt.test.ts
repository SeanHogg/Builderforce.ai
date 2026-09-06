import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveKeyCached,
  jwtMembershipHash,
  invalidateJwtMembershipCache,
  keyCacheKey,
} from './keyResolutionCache';
import { __clearL1CacheForTests } from '../cache/readThroughCache';
import type { Env } from '../../env';

/**
 * Gap [1237]: the JWT auth branch in requireTenantAccess used to hit Neon for
 * tenant_members on every request. It resolves through the same read-through
 * cache helper as the API-key paths, keyed on (tenantId, userId), with a short
 * self-healing TTL (no single membership-mutation hook).
 *
 * The helper prefixes every KV key with `cache:` and keeps an in-isolate L1, so
 * the expectations below are the shared helper's contract, not a private one.
 */

function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string, _type?: string) => {
      const raw = store.get(key);
      return raw ? JSON.parse(raw) : null;
    }),
    put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

beforeEach(() => __clearL1CacheForTests());

describe('jwtMembershipHash', () => {
  it('keys on tenant+user so all of a user\'s JWTs for that tenant share one entry', () => {
    expect(jwtMembershipHash(42, 'user-1')).toBe('42:user-1');
    expect(jwtMembershipHash(42, 'user-1')).not.toBe(jwtMembershipHash(43, 'user-1'));
  });
});

describe('JWT membership resolution via resolveKeyCached', () => {
  it('caches the first resolution and serves subsequent calls without re-loading', async () => {
    const kv = fakeKv();
    const env = { AUTH_CACHE_KV: kv as unknown } as unknown as Env;
    const loader = vi.fn(async () => ({ ok: true as const, payload: { isSuperadmin: true } }));

    const first = await resolveKeyCached(env, 'jwt', jwtMembershipHash(42, 'user-1'), loader);
    const second = await resolveKeyCached(env, 'jwt', jwtMembershipHash(42, 'user-1'), loader);

    expect(first).toEqual({ ok: true, payload: { isSuperadmin: true } });
    expect(second).toEqual(first);
    expect(loader).toHaveBeenCalledTimes(1); // second call is a cache hit
    expect(kv.store.has(`cache:${keyCacheKey('jwt', '42:user-1')}`)).toBe(true);
  });

  it('writes the JWT entry with the short TTL, not the 365-day key TTL', async () => {
    const kv = fakeKv();
    const env = { AUTH_CACHE_KV: kv as unknown } as unknown as Env;
    const loader = vi.fn(async () => ({ ok: true as const, payload: { isSuperadmin: false } }));

    await resolveKeyCached(env, 'jwt', jwtMembershipHash(1, 'u'), loader);

    const opts = kv.put.mock.calls[0]![2] as { expirationTtl: number };
    expect(opts.expirationTtl).toBe(60);
  });

  it('serves the in-isolate L1 when KV is unbound, and re-loads once it is invalidated', async () => {
    const env = { AUTH_CACHE_KV: undefined } as unknown as Env;
    const loader = vi.fn(async () => ({ ok: false as const, reason: 'not a member' }));

    await resolveKeyCached(env, 'jwt', jwtMembershipHash(1, 'u'), loader);
    await resolveKeyCached(env, 'jwt', jwtMembershipHash(1, 'u'), loader);
    expect(loader).toHaveBeenCalledTimes(1);

    await invalidateJwtMembershipCache(env, 1, 'u');
    await resolveKeyCached(env, 'jwt', jwtMembershipHash(1, 'u'), loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('re-loads after invalidateJwtMembershipCache drops the entry from both layers', async () => {
    const kv = fakeKv();
    const env = { AUTH_CACHE_KV: kv as unknown } as unknown as Env;
    let superadmin = false;
    const loader = vi.fn(async () => ({ ok: true as const, payload: { isSuperadmin: superadmin } }));

    await resolveKeyCached(env, 'jwt', jwtMembershipHash(42, 'user-1'), loader);
    superadmin = true; // membership/role changed out-of-band

    await invalidateJwtMembershipCache(env, 42, 'user-1');
    expect(kv.delete).toHaveBeenCalledWith(`cache:${keyCacheKey('jwt', '42:user-1')}`);
    const afterInvalidate = await resolveKeyCached(env, 'jwt', jwtMembershipHash(42, 'user-1'), loader);

    expect(loader).toHaveBeenCalledTimes(2); // the drop forced a re-load
    expect(afterInvalidate).toEqual({ ok: true, payload: { isSuperadmin: true } });
  });
});
