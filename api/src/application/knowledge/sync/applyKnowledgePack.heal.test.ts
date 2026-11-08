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
import { HEALED_LEAF_DIGEST } from '../knowledgeHeal';
import { bucketIdsOf, haveBitmap, manifestLeaves, manifestSummary } from './knowledgeSyncManifest';

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
const healFromA = (): Promise<unknown> => apply({
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

  it('regression: B sending the file again restores its leaf and the body, and leaves reconcile equal', async () => {
    const { b } = await sharedThenLost();
    await healFromA();
    const gen = w.roots.get(ROOT_B)!.generation;
    await apply({ ...packOf(b, { root: ROOT_B, generation: gen }), targetDigest: ZERO_DIGEST });
    expect(await reconcileFinds(ROOT_B, b)).toEqual([]);
    expect(await haveOf(ROOT_B, 'src/b.ts', SHARED)).toBe(true);
  });

  it('regression: a root whose file has moved on to another hash is not invalidated by the heal', async () => {
    await sharedThenLost();
    const moved = rowsOf('src/b.ts', hashOf(77));
    await apply(packOf(moved, { root: ROOT_B, generation: 1 }));
    const generation = w.roots.get(ROOT_B)!.generation;

    await healFromA();

    expect(w.leaves.get(ROOT_B)!.get('f:src/b.ts')).toBe(hashOf(77));
    expect(w.roots.get(ROOT_B)!.generation).toBe(generation);
    expect(await reconcileFinds(ROOT_B, moved)).toEqual([]);
  });
});
