import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __clearL1CacheForTests, getOrSetCached, invalidateCached, setCached } from './readThroughCache';
import type { Env } from '../../env';

/**
 * Workers KV rejects any expirationTtl below 60 seconds. Eleven call sites asked
 * for 10–45s, so every one of their KV writes threw into the best-effort catch
 * and silently degraded the shared cache to an L1-only, per-isolate Map — the
 * exact anti-pattern this helper exists to prevent.
 */
describe('readThroughCache KV TTL floor', () => {
  let put: ReturnType<typeof vi.fn>;
  let env: Env;

  beforeEach(() => {
    __clearL1CacheForTests();
    put = vi.fn(async () => undefined);
    env = {
      AUTH_CACHE_KV: { get: vi.fn(async () => null), put, delete: vi.fn(async () => undefined) },
    } as unknown as Env;
  });

  it('raises a sub-minute kvTtlSeconds to the KV minimum', async () => {
    await getOrSetCached(env, 'k1', async () => ({ v: 1 }), { kvTtlSeconds: 10 });
    expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 60 });
  });

  it('passes a TTL at or above the minimum through untouched', async () => {
    await getOrSetCached(env, 'k2', async () => ({ v: 2 }), { kvTtlSeconds: 300 });
    expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 300 });
  });

  it('applies the same floor to setCached', async () => {
    await setCached(env, 'k3', { v: 3 }, { kvTtlSeconds: 30 });
    expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 60 });
  });

  it('does not clamp l1TtlMs — in-isolate freshness stays as requested', async () => {
    const loader = vi.fn(async () => ({ v: 4 }));
    await getOrSetCached(env, 'k4', loader, { kvTtlSeconds: 10, l1TtlMs: 5 });
    await new Promise((r) => setTimeout(r, 20));
    // L1 entry expired after 5ms, so the second read must re-consult the loader
    // rather than serve the value for the clamped 60s.
    await getOrSetCached(env, 'k4', loader, { kvTtlSeconds: 10, l1TtlMs: 5 });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

/**
 * KV allows one write per second per key, so a burst bumping the same version
 * token 429s. Version tokens live for 24h, so a dropped bump would serve stale
 * reads for a day — invalidation has to retry past the per-key window.
 */
describe('invalidateCached rate-limit retry', () => {
  beforeEach(() => __clearL1CacheForTests());

  it('retries a 429 delete and succeeds', async () => {
    let attempts = 0;
    const del = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error('KV DELETE failed: 429 Too Many Requests');
      return undefined;
    });
    const env = { AUTH_CACHE_KV: { get: vi.fn(), put: vi.fn(), delete: del } } as unknown as Env;

    await invalidateCached(env, 'ver:tenant:1');
    expect(del).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-rate-limit failure', async () => {
    const del = vi.fn(async () => { throw new Error('KV DELETE failed: 500 Internal Error'); });
    const env = { AUTH_CACHE_KV: { get: vi.fn(), put: vi.fn(), delete: del } } as unknown as Env;

    await invalidateCached(env, 'ver:tenant:2');
    expect(del).toHaveBeenCalledTimes(1);
  });
});

describe('readThroughCache KV key bounds', () => {
  beforeEach(() => __clearL1CacheForTests());

  it('preserves existing short storage keys', async () => {
    const get = vi.fn(async (_key: string, _type: string) => null);
    const put = vi.fn(async (_key: string, _value: string, _options?: unknown) => undefined);
    const env = { AUTH_CACHE_KV: { get, put, delete: vi.fn() } } as unknown as Env;

    await getOrSetCached(env, 'compatible-key', async () => 'value');

    expect(get).toHaveBeenCalledWith('cache:compatible-key', 'json');
    expect(put.mock.calls[0]?.[0]).toBe('cache:compatible-key');
  });

  it('content-addresses oversized keys consistently for reads, writes, and invalidation', async () => {
    const get = vi.fn(async (_key: string, _type: string) => null);
    const put = vi.fn(async (_key: string, _value: string, _options?: unknown) => undefined);
    const del = vi.fn(async (_key: string) => undefined);
    const env = { AUTH_CACHE_KV: { get, put, delete: del } } as unknown as Env;
    const sourceKey = `search:${'é'.repeat(400)}`;

    await getOrSetCached(env, sourceKey, async () => ({ ok: true }));
    await invalidateCached(env, sourceKey);

    const readKey = String(get.mock.calls[0]?.[0]);
    const writeKey = String(put.mock.calls[0]?.[0]);
    const deleteKey = String(del.mock.calls[0]?.[0]);
    expect(readKey).toMatch(/^cache:sha256:[0-9a-f]{64}$/);
    expect(new TextEncoder().encode(readKey).byteLength).toBeLessThanOrEqual(512);
    expect(writeKey).toBe(readKey);
    expect(deleteKey).toBe(readKey);
    expect(readKey).not.toContain('é');
  });
});
