/**
 * applyKnowledgePack — the heal of an unreadable stored body, across roots (PRD 41 A11): a body lost from R2 is rewritten
 * from the arriving pack, and every OTHER root that shared the hash must send it again on its next sync, because the
 * reconcile compares manifest leaves, never bodies.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodePack, differingBuckets, encodePack, leafDelta, manifestTree, rootLeaves, ZERO_DIGEST, type Pack,
} from '@seanhogg/builderforce-memory/knowledge/pack';
import { atomically, newWorld, fakeStore, fakeExtracted, fakeLedger, fakeSync, type World } from './syncFakes.test-util';
import { extraction, hashOf, packOf, refOf, ROOT, type Rows } from './packFixtures.test-util';

const held = vi.hoisted(() => ({ world: null as null | { facts: Map<string, unknown> } }));
vi.mock('../../llm/projectFactsWrite', () => ({
  upsertProjectFacts: vi.fn(async (_e: unknown, _d: unknown, _t: unknown, _p: unknown, items: Array<{ key: string; content: string }>) => new Set(items.map((i) => i.key))),
  deleteProjectFact: vi.fn(async () => true),
}));
vi.mock('../knowledgeVersion', () => ({ bumpKnowledgeVersion: vi.fn(async () => undefined), knowledgeVersion: vi.fn() }));
vi.mock('../../../infrastructure/auth/superadminFlag', () => ({ resolveIsSuperadmin: vi.fn(async () => false) }));

import { applyKnowledgePack, type ApplyDeps } from './applyKnowledgePack';
import { HEALED_LEAF_DIGEST, lostRefsOf } from '../knowledgeHeal';
import { entrylessRef } from '../knowledgeLedger';
import { bucketIdsOf, haveBitmap, manifestGeneration, manifestLeaves, manifestSummary } from './knowledgeSyncManifest';

const ROOT_B = 'ws:other';
const SHARED = hashOf(500);

let w: World;
const deps = (): ApplyDeps => ({
  env: {} as never, db: {} as never, tenantId: 1, projectId: 2, userId: 'u1', actorRole: 'developer',
  store: fakeStore(w), extracted: fakeExtracted(w), sync: fakeSync(w), ledger: fakeLedger(w), atomically: atomically(w),
});
const apply = async (pack: Pack) => applyKnowledgePack(deps(), { body: await encodePack(pack) });
const manifestDeps = () => ({ sync: fakeSync(w), ledger: fakeLedger(w) });

const rowsOf = (path: string, hash: string): Rows => ({ files: [{ path, hash, bytes: 1 }], facts: [], relations: [] });

/** What the root's NEXT reconcile finds, with the client's own tree: the file keys it would send. */
async function reconcileFinds(root: string, rows: Rows): Promise<string[]> {
  const local = manifestTree(rootLeaves(root, rows));
  const server = await decodePack(await manifestSummary(manifestDeps(), root));
  const differing = differingBuckets(local.buckets, server.buckets!);
  if (differing.length === 0) return [];
  const ask = await encodePack({ rootId: root, baseGeneration: 0, targetDigest: ZERO_DIGEST, leaves: differing.map((b) => ({ key: `b:${b}`, digest: ZERO_DIGEST })) });
  const { rootId, buckets } = await bucketIdsOf(ask);
  const answer = await decodePack(await manifestLeaves(manifestDeps(), rootId, buckets));
  return leafDelta(local, answer.leaves ?? [], differing).upsert;
}

const haveOf = async (root: string, path: string, hash: string): Promise<boolean> => {
  const ask = await encodePack({ rootId: root, baseGeneration: 0, targetDigest: ZERO_DIGEST, stale: [{ sourceRef: refOf(root, path) as never, hash }] });
  return (((await haveBitmap({ sync: fakeSync(w) }, ask))[0] ?? 0) & 1) === 1;
};

/** Root A and root B both hold a file with the SHARED hash, then the stored body is lost. */
async function sharedThenLost(): Promise<{ a: Rows; b: Rows }> {
  const a = rowsOf('src/a.ts', SHARED);
  const b = rowsOf('src/b.ts', SHARED);
  await apply(packOf(a));
  await apply(packOf(b, { root: ROOT_B }));
  expect(await haveOf(ROOT_B, 'src/b.ts', SHARED)).toBe(true);
  w.bundles.clear(); // the object behind the shared index row is gone
  return { a, b };
}

/** Root A re-supplies the lost hash under a new path (its own delta pack at generation 1). */
const healFromA = () => apply({
  rootId: ROOT, baseGeneration: 1, files: [{ path: 'src/a2.ts', hash: SHARED, bytes: 1 }],
  extracted: [{ kind: 'full', hash: SHARED, entries: [extraction(ROOT, 'src/a2.ts', SHARED)] }], targetDigest: ZERO_DIGEST,
});

beforeEach(() => { w = newWorld(); held.world = w as never; });

describe('healing a lost body shared by two roots', () => {
  it('regression: root A heals a lost body that root B shared, and B\'s next reconcile asks for that file again', async () => {
    const { b } = await sharedThenLost();
    expect(await reconcileFinds(ROOT_B, b)).toEqual([]); // before the heal B looks perfectly in sync: reconcile compares leaves, not bodies

    await healFromA();

    expect(w.index.get(SHARED)!.sourceRefs).toEqual([refOf(ROOT, 'src/a2.ts')]); // B no longer has a server body
    expect(w.leaves.get(ROOT_B)!.get('f:src/b.ts')).toBe(HEALED_LEAF_DIGEST);
    expect(w.roots.get(ROOT_B)!.generation).toBe(2); // B's old ack is stale: a delta pack at it gets 409 and reconciles
    expect(await reconcileFinds(ROOT_B, b)).toEqual(['f:src/b.ts']); // exactly the affected file
    expect(await haveOf(ROOT_B, 'src/b.ts', SHARED)).toBe(false); // so the pack builder sends its body
  });

  it('guard: B sending the file again restores its leaf and the body, and leaves reconcile equal', async () => {
    const { b } = await sharedThenLost();
    await healFromA();
    const gen = w.roots.get(ROOT_B)!.generation;
    await apply({ ...packOf(b, { root: ROOT_B, generation: gen }), targetDigest: ZERO_DIGEST });
    expect(await reconcileFinds(ROOT_B, b)).toEqual([]);
    expect(await haveOf(ROOT_B, 'src/b.ts', SHARED)).toBe(true);
  });

  it('guard: a root whose file has moved on to another hash is not invalidated by the heal', async () => {
    await sharedThenLost();
    const moved = rowsOf('src/b.ts', hashOf(77));
    await apply(packOf(moved, { root: ROOT_B, generation: 1 }));
    const generation = w.roots.get(ROOT_B)!.generation;

    await healFromA();

    expect(w.leaves.get(ROOT_B)!.get('f:src/b.ts')).toBe(hashOf(77));
    expect(w.roots.get(ROOT_B)!.generation).toBe(generation);
    expect(await reconcileFinds(ROOT_B, moved)).toEqual([]);
  });

  it('regression: the applying root OWN other path that shared the lost hash is invalidated too, and the pack answers `reconcile`', async () => {
    await sharedThenLost();
    const aRows: Rows = { files: [{ path: 'src/a.ts', hash: SHARED, bytes: 1 }, { path: 'src/a2.ts', hash: SHARED, bytes: 1 }], facts: [], relations: [] };

    const res = await healFromA();

    expect(res).toMatchObject({ applied: true, reconcile: true, generation: 3 }); // the pack advanced 1 → 2, the invalidation 2 → 3
    expect(w.roots.get(ROOT)!.generation).toBe(3);
    expect(w.leaves.get(ROOT)!.get('f:src/a.ts')).toBe(HEALED_LEAF_DIGEST);
    expect(w.leaves.get(ROOT)!.get('f:src/a2.ts')).toBe(SHARED); // the path the pack re-supplied is untouched
    expect(await reconcileFinds(ROOT, aRows)).toEqual(['f:src/a.ts']);
    expect(await haveOf(ROOT, 'src/a.ts', SHARED)).toBe(false);
  });

  it("regression: a '#' in a path is part of the path, and a root id ending in ':' (a cloud root) is healed too", async () => {
    const CLOUD = 'cloud:7:';
    const refs = [refOf(ROOT, 'src/C#/a.cs'), refOf(ROOT, 'src/C#/old.cs'), `src:${CLOUD}::docs/x.md`];
    w.index.set(SHARED, { hash: SHARED, bundleKey: 'knowledge/1/2/bundles/gone', byteOffset: 0, byteLength: 10, sourceRefs: refs });
    w.leaves.set(ROOT, new Map([['f:src/C#/a.cs', SHARED], ['f:src/C#/old.cs', SHARED]]));
    w.leaves.set(CLOUD, new Map([['f:docs/x.md', SHARED]]));
    w.roots.set(ROOT, { generation: 1, digest: 'da' });
    w.roots.set(CLOUD, { generation: 1, digest: 'dc' });

    await apply({
      rootId: ROOT, baseGeneration: 1, files: [{ path: 'src/C#/a.cs', hash: SHARED, bytes: 1 }],
      extracted: [{ kind: 'full', hash: SHARED, entries: [extraction(ROOT, 'src/C#/a.cs', SHARED)] }], targetDigest: ZERO_DIGEST,
    });

    expect(w.leaves.get(ROOT)!.get('f:src/C#/old.cs')).toBe(HEALED_LEAF_DIGEST);
    expect(w.leaves.get(ROOT)!.get('f:src/C#/a.cs')).toBe(SHARED);
    expect(w.leaves.get(CLOUD)!.get('f:docs/x.md')).toBe(HEALED_LEAF_DIGEST);
    expect(w.roots.get(CLOUD)!.generation).toBe(2);
  });

  it('a pack that heals nothing does not ask for a reconcile', async () => {
    const res = await apply(packOf(rowsOf('src/a.ts', SHARED)));
    expect(res).not.toHaveProperty('reconcile');
  });

  it('guard: two lost hashes shared across two roots, healed by ONE pack, invalidate each root once', async () => {
    const H1 = hashOf(501), H2 = hashOf(502);
    const rows = (): Rows => ({ files: [{ path: 'src/x1.ts', hash: H1, bytes: 1 }, { path: 'src/x2.ts', hash: H2, bytes: 1 }], facts: [], relations: [] });
    await apply(packOf(rows()));
    await apply(packOf(rows(), { root: ROOT_B }));
    w.bundles.clear();

    await apply(packOf(rows(), { root: 'ws:third' }));

    for (const root of [ROOT, ROOT_B]) {
      expect(w.leaves.get(root)!.get('f:src/x1.ts')).toBe(HEALED_LEAF_DIGEST);
      expect(w.leaves.get(root)!.get('f:src/x2.ts')).toBe(HEALED_LEAF_DIGEST);
      expect(w.roots.get(root)!.generation).toBe(2); // both files in ONE advance
      expect((await reconcileFinds(root, rows())).sort()).toEqual(['f:src/x1.ts', 'f:src/x2.ts']);
    }
  });

  it('guard: entry-less refs of the old index row are named lost unless the rewritten body keeps them', () => {
    const ref = refOf(ROOT, 'src/bin.dat');
    const loc = { sourceRefs: [refOf(ROOT, 'src/a.ts'), entrylessRef(ref), entrylessRef(refOf(ROOT_B, 'src/b.bin'))] };
    expect(lostRefsOf(loc, { entries: [{ sourceRef: refOf(ROOT, 'src/a.ts') }], entryless: [ref] })).toEqual([refOf(ROOT_B, 'src/b.bin')]);
    expect(lostRefsOf(loc, { entries: [], entryless: [] }).sort()).toEqual([refOf(ROOT, 'src/a.ts'), ref, refOf(ROOT_B, 'src/b.bin')].sort());
  });

  it('guard: a root with leaves but no roots row is left as it is (its next sync is a full pack), and the heal still completes', async () => {
    await sharedThenLost();
    w.leaves.set('ws:ghost', new Map([['f:src/g.ts', SHARED]]));
    w.index.get(SHARED)!.sourceRefs.push(refOf('ws:ghost', 'src/g.ts'));

    await healFromA();

    expect(w.leaves.get('ws:ghost')!.get('f:src/g.ts')).toBe(SHARED);
    expect(w.roots.has('ws:ghost')).toBe(false);
    expect(w.buckets.has('ws:ghost')).toBe(false);
    expect(w.leaves.get(ROOT_B)!.get('f:src/b.ts')).toBe(HEALED_LEAF_DIGEST);
  });

  it('the generation-only read answers the roots row and touches no bucket', async () => {
    await sharedThenLost();
    await healFromA();
    const reads = w.indexQueries;
    expect(await manifestGeneration({ sync: fakeSync(w) }, ROOT_B)).toEqual({ generation: 2, digest: w.roots.get(ROOT_B)!.digest });
    expect(await manifestGeneration({ sync: fakeSync(w) }, 'ws:never')).toEqual({ generation: 0, digest: '' });
    expect(w.indexQueries).toBe(reads);
  });
});
