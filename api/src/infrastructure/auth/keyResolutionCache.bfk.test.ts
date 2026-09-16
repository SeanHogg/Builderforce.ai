import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveKeyCached,
  invalidateKeyCache,
  keyCacheKey,
} from './keyResolutionCache';
import { __clearL1CacheForTests } from '../cache/readThroughCache';
import type { Env } from '../../env';

/**
 * The `bfk` cached-value schema version.
 *
 * `bfk` payloads gained `createdByUserId` in api 2026.9.23. With a 365-day TTL and no
 * mutation to invalidate from (nothing about the key changed — only the code reading
 * it), entries written before that release kept resolving to a null creator, so the
 * caller fell to the anonymous DEVELOPER floor and their own workspace answered
 * "403 manager role required". The version segment orphans those entries.
 *
 * `clk`/`jwt` keys must stay byte-identical so this deploy does not silently drop
 * every agentHost/membership hit already in KV.
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

describe('keyCacheKey versioning', () => {
  it('carries the schema version on bfk keys', () => {
    expect(keyCacheKey('bfk', 'abc123')).toBe('auth:bfk:v2:abc123');
  });

  it('leaves clk and jwt keys unversioned so existing entries keep hitting', () => {
    expect(keyCacheKey('clk', 'abc123')).toBe('auth:clk:abc123');
    expect(keyCacheKey('jwt', '42:user-1')).toBe('auth:jwt:42:user-1');
  });

  it('does not serve a pre-version bfk entry (the one without createdByUserId)', async () => {
    const kv = fakeKv();
    const env = { AUTH_CACHE_KV: kv as unknown } as unknown as Env;
    // An entry written by a build before 2026.9.23: no createdByUserId, so the key
    // resolved to nobody and the caller got the DEVELOPER floor.
    kv.store.set(
      'cache:auth:bfk:abc123',
      JSON.stringify({ ok: true, payload: { id: 'k1', tenantId: 7 } }),
    );
    const loader = vi.fn(async () => ({
      ok: true as const,
      payload: { id: 'k1', tenantId: 7, createdByUserId: 'user-1' },
    }));

    const resolved = await resolveKeyCached(env, 'bfk', 'abc123', loader);

    expect(loader).toHaveBeenCalledTimes(1); // the stale entry was not a hit
    expect(resolved).toEqual({ ok: true, payload: { id: 'k1', tenantId: 7, createdByUserId: 'user-1' } });
    expect(kv.store.has('cache:auth:bfk:v2:abc123')).toBe(true);
  });

  it('caches under the versioned key and serves the second call from it', async () => {
    const kv = fakeKv();
    const env = { AUTH_CACHE_KV: kv as unknown } as unknown as Env;
    const loader = vi.fn(async () => ({ ok: true as const, payload: { tenantId: 7, createdByUserId: 'user-1' } }));

    await resolveKeyCached(env, 'bfk', 'abc123', loader);
    await resolveKeyCached(env, 'bfk', 'abc123', loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(kv.put.mock.calls[0]![0]).toBe(`cache:${keyCacheKey('bfk', 'abc123')}`);
  });

  it('writes bfk entries with the 365-day TTL', async () => {
    const kv = fakeKv();
    const env = { AUTH_CACHE_KV: kv as unknown } as unknown as Env;
    const loader = vi.fn(async () => ({ ok: true as const, payload: { tenantId: 7 } }));

    await resolveKeyCached(env, 'bfk', 'abc123', loader);

    const opts = kv.put.mock.calls[0]![2] as { expirationTtl: number };
    expect(opts.expirationTtl).toBe(365 * 24 * 60 * 60);
  });

  it('invalidates the SAME versioned key it reads (one seam, both halves)', async () => {
    const kv = fakeKv();
    const env = { AUTH_CACHE_KV: kv as unknown } as unknown as Env;
    let createdByUserId: string | null = null;
    const loader = vi.fn(async () => ({ ok: true as const, payload: { tenantId: 7, createdByUserId } }));

    await resolveKeyCached(env, 'bfk', 'abc123', loader);
    createdByUserId = 'user-1';

    await invalidateKeyCache(env, 'bfk', 'abc123');
    expect(kv.delete).toHaveBeenCalledWith('cache:auth:bfk:v2:abc123');

    const afterInvalidate = await resolveKeyCached(env, 'bfk', 'abc123', loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(afterInvalidate).toEqual({ ok: true, payload: { tenantId: 7, createdByUserId: 'user-1' } });
  });

  it('invalidating clk still targets the unversioned key', async () => {
    const kv = fakeKv();
    const env = { AUTH_CACHE_KV: kv as unknown } as unknown as Env;

    await invalidateKeyCache(env, 'clk', 'abc123');

    expect(kv.delete).toHaveBeenCalledWith('cache:auth:clk:abc123');
  });
});
