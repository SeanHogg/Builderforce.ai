import { describe, expect, it, vi } from 'vitest';
import { semanticLookup, semanticStore } from './semanticCache';
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

  it('trims a partition to its bound (newest kept)', async () => {
    const kv = fakeKV();
    const env = envWith(kv);
    const t = nextTenant();
    for (let i = 0; i < 205; i++) {
      await semanticStore(env, t, 'default', [i, 1], `r${i}`);
    }
    const stored = JSON.parse(kv.store.get(`semcache:${t}:default`)!) as unknown[];
    expect(stored.length).toBe(200);          // capped
    expect((stored[0] as { r: string }).r).toBe('r204'); // newest first
  });

  it('degrades to miss / no-op when SEMANTIC_CACHE_KV is unbound', async () => {
    const env = envWith(undefined);
    const t = nextTenant();
    await expect(semanticStore(env, t, 'default', [1, 0], 'x')).resolves.toBeUndefined();
    expect(await semanticLookup(env, t, 'default', [1, 0], 0.5)).toBeNull();
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
