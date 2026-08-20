import { describe, expect, it, vi } from 'vitest';
import { semanticInvalidate, semanticLookup, semanticStore } from './semanticCache';
import type { Env } from '../../env';

// Minimal Map-backed KV stub (get supports the 'json' mode used by the service).
function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => {
      const v = store.get(k);
      return v == null ? null : JSON.parse(v);
    }),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
  };
}

// Unique tenant id per test so the read-through cache's in-isolate L1 (module
// state in readThroughCache) never leaks between cases.
let _tenant = 1000;
const nextTenant = () => ++_tenant;

function envWith(kv: ReturnType<typeof fakeKV> | undefined): Env {
  return { SEMANTIC_CACHE_KV: kv } as unknown as Env;
}

describe('semanticStore + semanticLookup', () => {
  it('stores then returns the response on a near-identical embedding', async () => {
    const env = envWith(fakeKV());
    const t = nextTenant();
    await semanticStore(env, t, 'default', [1, 0, 0], 'cached answer');

    const hit = await semanticLookup(env, t, 'default', [0.99, 0.1, 0], 0.92);
    expect(hit).not.toBeNull();
    expect(hit!.response).toBe('cached answer');
    expect(hit!.score).toBeGreaterThanOrEqual(0.92);
  });

  it('returns null when nothing is within threshold', async () => {
    const env = envWith(fakeKV());
    const t = nextTenant();
    await semanticStore(env, t, 'default', [1, 0], 'answer');
    expect(await semanticLookup(env, t, 'default', [0, 1], 0.92)).toBeNull(); // orthogonal
  });

  it('partitions by tenant and namespace (no cross-hit)', async () => {
    const env = envWith(fakeKV());
    const a = nextTenant();
    const b = nextTenant();
    await semanticStore(env, a, 'ns1', [1, 0], 'A answer');

    expect(await semanticLookup(env, b, 'ns1', [1, 0], 0.5)).toBeNull();       // other tenant
    expect(await semanticLookup(env, a, 'ns2', [1, 0], 0.5)).toBeNull();       // other namespace
    expect((await semanticLookup(env, a, 'ns1', [1, 0], 0.5))?.response).toBe('A answer');
  });

  it('bounds each BUCKET, not the whole partition — the corpus is no longer capped at 200', async () => {
    // The regression this replaces: one bounded list per tenant+namespace meant a busy
    // namespace evicted its own hits, so the hit rate FELL as the cache was used more.
    // With a keyed index the bound is per bucket, and total capacity is
    // buckets x tables x bucket-bound — orders of magnitude past the old 200.
    const kv = fakeKV();
    const env = envWith(kv);
    const t = nextTenant();
    for (let i = 0; i < 205; i++) {
      await semanticStore(env, t, 'default', [i, 1], `r${i}`);
    }
    const partitionKeys = [...kv.store.keys()].filter((k) => k.startsWith(`semcache:${t}:default:`));
    expect(partitionKeys.length).toBeGreaterThan(1); // a real index, not one list

    const total = partitionKeys.reduce((n, k) => n + (JSON.parse(kv.store.get(k)!) as unknown[]).length, 0);
    // Every write lands in HASH_TABLES buckets, so the stored-copy count is a multiple
    // of the distinct associations retained — and far exceeds the old whole-partition cap.
    expect(total).toBeGreaterThan(200);
    for (const key of partitionKeys) {
      expect((JSON.parse(kv.store.get(key)!) as unknown[]).length).toBeLessThanOrEqual(64);
    }
  });

  it('a stored association is still found after the corpus grows past the old cap', async () => {
    // Directly the failure the bound used to cause: entry #1 evicted by entry #201.
    const env = envWith(fakeKV());
    const t = nextTenant();
    await semanticStore(env, t, 'default', [1, 0, 0], 'the first answer');
    for (let i = 0; i < 300; i++) {
      await semanticStore(env, t, 'default', [Math.cos(i), Math.sin(i), 0.5], `noise-${i}`);
    }
    const hit = await semanticLookup(env, t, 'default', [0.999, 0.02, 0], 0.92);
    expect(hit?.response).toBe('the first answer');
  });

  it('degrades to miss / no-op when SEMANTIC_CACHE_KV is unbound', async () => {
    const env = envWith(undefined);
    const t = nextTenant();
    await expect(semanticStore(env, t, 'default', [1, 0], 'x')).resolves.toBeUndefined();
    expect(await semanticLookup(env, t, 'default', [1, 0], 0.5)).toBeNull();
  });

  it('invalidates only the requested tenant and namespace partition', async () => {
    const env = envWith(fakeKV());
    const a = nextTenant(), b = nextTenant();
    await semanticStore(env, a, 'scope-a', [1, 0], 'remove');
    await semanticStore(env, a, 'scope-b', [1, 0], 'keep namespace');
    await semanticStore(env, b, 'scope-a', [1, 0], 'keep tenant');
    await semanticInvalidate(env, a, 'scope-a');
    expect(await semanticLookup(env, a, 'scope-a', [1, 0], .9)).toBeNull();
    expect((await semanticLookup(env, a, 'scope-b', [1, 0], .9))?.response).toBe('keep namespace');
    expect((await semanticLookup(env, b, 'scope-a', [1, 0], .9))?.response).toBe('keep tenant');
  });

  it('rejects empty / malformed inputs', async () => {
    const env = envWith(fakeKV());
    const t = nextTenant();
    await semanticStore(env, t, 'default', [], 'x');          // empty embedding → no-op
    await semanticStore(env, t, 'default', [1, 0], '');        // empty response → no-op
    expect(await semanticLookup(env, t, 'default', [], 0.5)).toBeNull(); // empty query
    expect(await semanticLookup(env, t, 'default', [1, 0], 0.5)).toBeNull(); // nothing stored
  });
});
