import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReadThroughCache, kvStorageKey, sha256HexBytes, toJsonShape, type KvNamespaceLike } from './index';

function memoryKv(): KvNamespaceLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null)),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: vi.fn(async (k: string) => {
      store.delete(k);
    }),
  };
}

describe('createReadThroughCache · read-through + invalidate', () => {
  it('re-runs the loader after the key is invalidated', async () => {
    const cache = createReadThroughCache();
    const kv = memoryKv();
    const key = 'task-assignees:tenant:91249';
    const loader = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a', name: 'Ada' }])
      .mockResolvedValueOnce([{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bo' }]);

    expect(await cache.getOrSet(kv, key, loader)).toEqual([{ id: 'a', name: 'Ada' }]);
    expect(await cache.getOrSet(kv, key, loader)).toEqual([{ id: 'a', name: 'Ada' }]);
    expect(loader).toHaveBeenCalledTimes(1);

    await cache.invalidate(kv, key);

    expect(await cache.getOrSet(kv, key, loader)).toEqual([{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bo' }]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('serves a second isolate (fresh L1) from KV without a loader call', async () => {
    const kv = memoryKv();
    const a = createReadThroughCache();
    const b = createReadThroughCache();
    const loader = vi.fn(async () => ({ v: 1 }));
    await a.getOrSet(kv, 'shared', loader);
    expect(await b.getOrSet(kv, 'shared', loader)).toEqual({ v: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('falls through to the loader with no KV bound', async () => {
    const cache = createReadThroughCache();
    const loader = vi.fn(async () => 'x');
    expect(await cache.getOrSet(undefined, 'k', loader)).toBe('x');
    expect(await cache.getOrSet(undefined, 'k', loader)).toBe('x');
    // The L1 still serves the repeat; only cross-isolate sharing is lost.
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('peek never runs a loader and set writes both layers', async () => {
    const cache = createReadThroughCache();
    const kv = memoryKv();
    expect(await cache.peek(kv, 'p')).toBeNull();
    await cache.set(kv, 'p', { n: 1 });
    expect(await cache.peek(kv, 'p')).toEqual({ n: 1 });
    cache.clearL1();
    expect(await cache.peek(kv, 'p')).toEqual({ n: 1 });
  });

  it('clearL1 does not touch KV', async () => {
    const cache = createReadThroughCache();
    const kv = memoryKv();
    await cache.set(kv, 'k', 1);
    cache.clearL1();
    expect(kv.store.size).toBe(1);
  });
});

/**
 * Workers KV rejects any expirationTtl below 60 seconds. Eleven call sites asked
 * for 10–45s, so every one of their KV writes threw into the best-effort catch
 * and silently degraded the shared cache to an L1-only, per-isolate Map — the
 * exact anti-pattern this helper exists to prevent.
 */
describe('createReadThroughCache · KV TTL floor', () => {
  let put: ReturnType<typeof vi.fn>;
  let kv: KvNamespaceLike;
  let cache: ReturnType<typeof createReadThroughCache>;

  beforeEach(() => {
    cache = createReadThroughCache();
    put = vi.fn(async () => undefined);
    kv = { get: vi.fn(async () => null), put, delete: vi.fn(async () => undefined) } as unknown as KvNamespaceLike;
  });

  it('raises a sub-minute kvTtlSeconds to the KV minimum', async () => {
    await cache.getOrSet(kv, 'k1', async () => ({ v: 1 }), { kvTtlSeconds: 10 });
    expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 60 });
  });

  it('passes a TTL at or above the minimum through untouched', async () => {
    await cache.getOrSet(kv, 'k2', async () => ({ v: 2 }), { kvTtlSeconds: 300 });
    expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 300 });
  });

  it('returns the same JSON timestamp shape on a loader miss and later cache hits', async () => {
    const loaded = await cache.getOrSet(kv, 'date-shape', async () => ({ at: new Date('2026-07-25T07:11:00.123Z') }));
    expect(loaded).toEqual({ at: '2026-07-25T07:11:00.123Z' });
    expect(await cache.getOrSet(kv, 'date-shape', async () => ({ at: new Date(0) }))).toEqual(loaded);
    expect(JSON.parse(String(put.mock.calls[0]?.[1]))).toEqual(loaded);
  });

  it('applies the same floor to set', async () => {
    await cache.set(kv, 'k3', { v: 3 }, { kvTtlSeconds: 30 });
    expect(put.mock.calls[0]?.[2]).toEqual({ expirationTtl: 60 });
  });

  it('does not clamp l1TtlMs — in-isolate freshness stays as requested', async () => {
    const loader = vi.fn(async () => ({ v: 4 }));
    await cache.getOrSet(kv, 'k4', loader, { kvTtlSeconds: 10, l1TtlMs: 5 });
    await new Promise((r) => setTimeout(r, 20));
    await cache.getOrSet(kv, 'k4', loader, { kvTtlSeconds: 10, l1TtlMs: 5 });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('createReadThroughCache · injected error reporting and delete retry', () => {
  it('reports a failed KV read and still serves the loader', async () => {
    const onError = vi.fn();
    const cache = createReadThroughCache({ onError });
    const kv: KvNamespaceLike = {
      get: vi.fn(async () => { throw new Error('KV GET failed'); }),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    expect(await cache.getOrSet(kv, 'boom', async () => 'fresh')).toBe('fresh');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toEqual({
      operation: 'getOrSet',
      cacheOperation: 'get',
      storageKey: 'cache:boom',
      sourceKeyBytes: 4,
    });
  });

  it('reports a failed KV write as a put and a failed delete as a delete', async () => {
    const onError = vi.fn();
    const cache = createReadThroughCache({ onError });
    const kv: KvNamespaceLike = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => { throw new Error('KV PUT failed'); }),
      delete: vi.fn(async () => { throw new Error('KV DELETE failed'); }),
    };
    await cache.set(kv, 'w', 1);
    await cache.invalidate(kv, 'w');
    expect(onError.mock.calls.map((call) => (call[1] as { cacheOperation: string }).cacheOperation)).toEqual(['put', 'delete']);
  });

  it('routes the KV delete through retryDelete', async () => {
    let attempts = 0;
    const del = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error('KV DELETE failed: 429 Too Many Requests');
    });
    const retryDelete = vi.fn(async (op: () => Promise<void>) => {
      try {
        await op();
      } catch {
        await op();
      }
    });
    const cache = createReadThroughCache({ retryDelete });
    await cache.invalidate({ get: vi.fn(), put: vi.fn(), delete: del } as unknown as KvNamespaceLike, 'ver:tenant:1');
    expect(retryDelete).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(2);
  });
});

describe('kvStorageKey · KV key bounds', () => {
  it('preserves existing short storage keys', async () => {
    const cache = createReadThroughCache();
    const get = vi.fn(async (_key: string, _type: string) => null);
    const put = vi.fn(async (_key: string, _value: string, _options?: unknown) => undefined);
    const kv = { get, put, delete: vi.fn() } as unknown as KvNamespaceLike;

    await cache.getOrSet(kv, 'compatible-key', async () => 'value');

    expect(get).toHaveBeenCalledWith('cache:compatible-key', 'json');
    expect(put.mock.calls[0]?.[0]).toBe('cache:compatible-key');
    expect(await kvStorageKey('compatible-key')).toBe('cache:compatible-key');
  });

  it('content-addresses oversized keys consistently for reads, writes, and invalidation', async () => {
    const cache = createReadThroughCache();
    const get = vi.fn(async (_key: string, _type: string) => null);
    const put = vi.fn(async (_key: string, _value: string, _options?: unknown) => undefined);
    const del = vi.fn(async (_key: string) => undefined);
    const kv = { get, put, delete: del } as unknown as KvNamespaceLike;
    const sourceKey = `search:${'é'.repeat(400)}`;

    await cache.getOrSet(kv, sourceKey, async () => ({ ok: true }));
    await cache.invalidate(kv, sourceKey);

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

describe('primitives', () => {
  it('sha256HexBytes matches the known digest of "abc"', async () => {
    expect(await sha256HexBytes(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('toJsonShape turns Dates into ISO strings and leaves undefined alone', () => {
    expect(toJsonShape({ at: new Date(0) })).toEqual({ at: '1970-01-01T00:00:00.000Z' });
    expect(toJsonShape(undefined)).toBeUndefined();
  });
});
