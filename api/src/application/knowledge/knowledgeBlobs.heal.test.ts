/**
 * The legacy per-hash upload heals an unreadable stored body the way a pack does (PRD 41 A11): the roots that shared the lost
 * body send it again. The blob adapter only reports the heal; the application's hook (`invalidateHealedBody`) does the manifest
 * work, inside the same locked transaction as the index write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Extracted } from '@seanhogg/builderforce-memory/knowledge';
import { r2ExtractedCache } from './knowledgeBlobs';
import { HEALED_LEAF_DIGEST, invalidateHealedBody } from './knowledgeHeal';
import type { KnowledgeLedgerPort } from './knowledgeLedger';
import { KnowledgeSyncError } from './sync/knowledgeSyncPorts';
import { fakeLedger, newWorld, type World } from './sync/syncFakes.test-util';
import { extraction, hashOf, refOf } from './sync/packFixtures.test-util';

vi.mock('../observability/caughtErrorReporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../observability/caughtErrorReporter')>()),
  reportCaughtError: vi.fn(),
}));

const ROOT_A = 'ws:a';
const ROOT_B = 'ws:b';
const SHARED = hashOf(900);
const enc = new TextEncoder();

let w: World;
beforeEach(() => { w = newWorld(); });

/** An R2 bucket over the world's bundle objects (whole or ranged reads). */
function bucketOver(world: World): R2Bucket {
  return {
    async get(key: string, opts?: { range?: { offset: number; length: number } }) {
      const bytes = world.bundles.get(key);
      if (!bytes) return null;
      const slice = opts?.range ? bytes.subarray(opts.range.offset, opts.range.offset + opts.range.length) : bytes;
      return { arrayBuffer: async () => slice.slice().buffer, json: async () => JSON.parse(new TextDecoder().decode(slice)) as unknown };
    },
    async put(key: string, body: string | Uint8Array) { world.bundles.set(key, typeof body === 'string' ? enc.encode(body) : body); },
    async delete() { /* nothing to delete */ },
    async head(key: string) { return world.bundles.has(key) ? { key } : null; },
    async list() { return { objects: [], truncated: false }; },
  } as unknown as R2Bucket;
}

const cacheOver = (ledger: KnowledgeLedgerPort) =>
  r2ExtractedCache({ UPLOADS: bucketOver(w) } as never, 1, 2, { ledger, onHealed: invalidateHealedBody });

/** Roots A (two paths) and B (one) all name SHARED; its index row points at an object that is gone. */
function sharedBodyLost(): void {
  const refs = [refOf(ROOT_A, 'src/a.ts'), refOf(ROOT_A, 'src/a-other.ts'), refOf(ROOT_B, 'src/b.ts')];
  w.index.set(SHARED, { hash: SHARED, bundleKey: 'knowledge/1/2/bundles/gone', byteOffset: 0, byteLength: 10, sourceRefs: refs });
  w.leaves.set(ROOT_A, new Map([['f:src/a.ts', SHARED], ['f:src/a-other.ts', SHARED]]));
  w.leaves.set(ROOT_B, new Map([['f:src/b.ts', SHARED]]));
  w.roots.set(ROOT_A, { generation: 1, digest: 'da' });
  w.roots.set(ROOT_B, { generation: 1, digest: 'db' });
}

const uploadFromA = (cache: ReturnType<typeof cacheOver>): Promise<void> =>
  cache.put(SHARED, [extraction(ROOT_A, 'src/a.ts', SHARED) as Extracted]);

describe('legacy upload healing a lost shared body', () => {
  it('regression: poisons the other root and the uploader\'s other path, one generation bump each', async () => {
    sharedBodyLost();

    await uploadFromA(cacheOver(fakeLedger(w)));

    expect(w.leaves.get(ROOT_B)!.get('f:src/b.ts')).toBe(HEALED_LEAF_DIGEST);
    expect(w.roots.get(ROOT_B)!.generation).toBe(2);
    expect(w.leaves.get(ROOT_A)!.get('f:src/a-other.ts')).toBe(HEALED_LEAF_DIGEST);
    expect(w.leaves.get(ROOT_A)!.get('f:src/a.ts')).toBe(SHARED); // the path the upload re-supplied
    expect(w.roots.get(ROOT_A)!.generation).toBe(2);
    expect(w.index.get(SHARED)!.sourceRefs).toEqual([refOf(ROOT_A, 'src/a.ts')]);
  });

  it('guard: a readable body heals nothing', async () => {
    sharedBodyLost();
    const cache = cacheOver(fakeLedger(w));
    await uploadFromA(cache); // heals once
    const b = w.roots.get(ROOT_B)!.generation;

    await uploadFromA(cache); // the body is readable now

    expect(w.roots.get(ROOT_B)!.generation).toBe(b);
  });

  it('regression: a lost race (the conditional index write lands 0 rows) poisons nothing', async () => {
    sharedBodyLost();
    const real = fakeLedger(w);
    const rigged: KnowledgeLedgerPort = { ...real, index: { ...real.index, upsert: async () => 0 }, exclusive: (work) => work(rigged) };

    await expect(uploadFromA(cacheOver(rigged))).rejects.toBeInstanceOf(KnowledgeSyncError);

    expect(w.leaves.get(ROOT_B)!.get('f:src/b.ts')).toBe(SHARED);
    expect(w.leaves.get(ROOT_A)!.get('f:src/a-other.ts')).toBe(SHARED);
    expect(w.roots.get(ROOT_B)!.generation).toBe(1);
    expect(w.roots.get(ROOT_A)!.generation).toBe(1);
  });

  it("regression: a '#' in a path is part of the path, and a root id ending in ':' (a cloud root) is healed too", async () => {
    const CLOUD = 'cloud:7:';
    const refs = [refOf(ROOT_A, 'src/C#/a.cs'), refOf(ROOT_A, 'src/C#/old.cs'), `src:${CLOUD}::docs/x.md`];
    w.index.set(SHARED, { hash: SHARED, bundleKey: 'knowledge/1/2/bundles/gone', byteOffset: 0, byteLength: 10, sourceRefs: refs });
    w.leaves.set(ROOT_A, new Map([['f:src/C#/a.cs', SHARED], ['f:src/C#/old.cs', SHARED]]));
    w.leaves.set(CLOUD, new Map([['f:docs/x.md', SHARED]]));
    w.roots.set(ROOT_A, { generation: 1, digest: 'da' });
    w.roots.set(CLOUD, { generation: 1, digest: 'dc' });

    await cacheOver(fakeLedger(w)).put(SHARED, [extraction(ROOT_A, 'src/C#/a.cs', SHARED) as Extracted]);

    expect(w.leaves.get(ROOT_A)!.get('f:src/C#/old.cs')).toBe(HEALED_LEAF_DIGEST);
    expect(w.leaves.get(ROOT_A)!.get('f:src/C#/a.cs')).toBe(SHARED);
    expect(w.leaves.get(CLOUD)!.get('f:docs/x.md')).toBe(HEALED_LEAF_DIGEST);
    expect(w.roots.get(CLOUD)!.generation).toBe(2);
  });
});

describe('the blob adapter keeps source objects by their FULL path', () => {
  it("regression: paths 'src/C#/a.cs' and 'src/C#/b.cs' are two sources, and removing one removes only it", async () => {
    const cache = cacheOver(fakeLedger(w));
    await cache.setSource(refOf(ROOT_A, 'src/C#/a.cs') as never, 'h1');
    await cache.setSource(refOf(ROOT_A, 'src/C#/b.cs') as never, 'h2');
    expect([...w.sources.get(ROOT_A)!.values()].map((r) => r.path).sort()).toEqual(['src/C#/a.cs', 'src/C#/b.cs']);

    await cache.setSource(refOf(ROOT_A, 'src/C#/a.cs') as never, '');

    const rows = [...w.sources.get(ROOT_A)!.values()];
    expect(rows.find((r) => r.hash === 'h2')?.path).toBe('src/C#/b.cs');
    expect(rows.filter((r) => r.hash === '')).toHaveLength(1);
  });
});
