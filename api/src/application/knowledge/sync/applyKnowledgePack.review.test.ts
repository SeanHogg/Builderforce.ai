/**
 * Review fixes of pack sync (PRD 41 A11): a full pack replaces the root's leaves and buckets whatever was left behind; the
 * skipped bodies are re-verified under the project lock; a cascaded relation delete takes this root's leaf with it; the
 * manifest answers at one generation; the have request and the facts refuse NUL and lone surrogates with a 422.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { KnowledgeLedgerPort } from '../knowledgeLedger';
import { decodePack, encodePack, fileLeafKey, manifestTree, relationDigest, relationLeafKey, rootDigestOf, ZERO_DIGEST, type Pack } from '@seanhogg/builderforce-memory/knowledge/pack';
import type { StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import { atomically, fakeExtracted, fakeLedger, fakeStore, fakeSync, newWorld, type World } from './syncFakes.test-util';
import { extraction, factOf, hashOf, packOf, ROOT, rowsFor, type Rows } from './packFixtures.test-util';

const held = vi.hoisted(() => ({ world: null as null | { facts: Map<string, unknown> } }));
vi.mock('../../llm/projectFactsWrite', () => ({
  upsertProjectFacts: vi.fn(async (_e: unknown, _d: unknown, _t: unknown, _p: unknown, items: Array<{ key: string; content: string; source?: string; opts?: { fileAnchors?: unknown[]; factOrigin?: string } }>) => {
    for (const it of items) {
      held.world!.facts.set(it.key, { key: it.key, content: it.content, source: it.source ?? 'agent', importance: 0.5, origin: it.opts?.factOrigin ?? 'model', fileAnchors: it.opts?.fileAnchors ?? [], createdBy: null });
    }
    return new Set(items.map((i) => i.key));
  }),
  deleteProjectFact: vi.fn(async () => true),
}));
vi.mock('../knowledgeVersion', () => ({ bumpKnowledgeVersion: vi.fn(async () => undefined), knowledgeVersion: vi.fn() }));
vi.mock('../../../infrastructure/auth/superadminFlag', () => ({ resolveIsSuperadmin: vi.fn(async () => false) }));

import { applyKnowledgePack, type ApplyDeps } from './applyKnowledgePack';
import { haveBitmap, manifestLeaves, manifestSummary } from './knowledgeSyncManifest';
import { r2KnowledgeSync } from './knowledgeSyncBlobs';
import { checkHavePairs } from './packValidation';

const A = 'ws:a';
const B = 'ws:b';

let w: World;
const deps = (over: Partial<ApplyDeps> = {}): ApplyDeps => ({
  env: {} as never, db: {} as never, tenantId: 1, projectId: 2, userId: 'u1', actorRole: 'developer',
  store: fakeStore(w), extracted: fakeExtracted(w), sync: fakeSync(w), ledger: fakeLedger(w), atomically: atomically(w), ...over,
});
const apply = async (pack: Pack, over: Partial<ApplyDeps> = {}) => applyKnowledgePack(deps(over), { body: await encodePack(pack) });
const rel = (from: string, to: string, kind: string): StoredRelation => ({ from, to, kind, weight: 1, origin: 'model' } as StoredRelation);

beforeEach(() => { w = newWorld(); held.world = w as never; });

describe('M1: a full pack replaces what the root left behind', () => {
  it('orphan leaves and bucket digests do not wedge the root on digest_mismatch', async () => {
    w.buckets.set(ROOT, new Map([[5, 'deadbeef'], [77, 'cafe']]));
    w.leaves.set(ROOT, new Map([['f:ghost.ts', 'x']]));
    const rows = rowsFor(3);
    const res = await apply(packOf(rows));
    expect(res).toMatchObject({ applied: true, generation: 1, digest: rootDigestOf(ROOT, rows) });
    expect(w.leaves.get(ROOT)!.has('f:ghost.ts')).toBe(false);
    expect(w.buckets.get(ROOT)!.get(5)).not.toBe('deadbeef');
    expect(w.buckets.get(ROOT)!.get(77)).not.toBe('cafe');
  });

  it('a delta pack keeps the root\'s leaves (only a full pack clears)', async () => {
    const rows = rowsFor(3, 0);
    await apply(packOf(rows));
    const more = { ...rows, files: [...rows.files, { path: 'src/new.ts', hash: hashOf(50), bytes: 1 }] };
    const delta: Pack = {
      rootId: ROOT, baseGeneration: 1, files: [more.files[3]!],
      extracted: [{ kind: 'full', hash: hashOf(50), entries: [extraction(ROOT, 'src/new.ts', hashOf(50))] }],
      targetDigest: rootDigestOf(ROOT, more),
    };
    expect(await apply(delta)).toMatchObject({ applied: true, generation: 2 });
    expect(w.leaves.get(ROOT)!.size).toBe(4);
  });

  it('clearRoot runs in one transaction under the project lock', async () => {
    const ledger = fakeLedger(w);
    const exclusive = vi.fn(ledger.exclusive) as unknown as Mock<KnowledgeLedgerPort['exclusive']> & KnowledgeLedgerPort['exclusive'];
    w.leaves.set(ROOT, new Map([['f:a', 'd']]));
    w.buckets.set(ROOT, new Map([[1, 'd']]));
    w.roots.set(ROOT, { generation: 1, digest: 'd' });
    await r2KnowledgeSync({} as never, 1, 2, { ...ledger, exclusive }).clearRoot(ROOT);
    expect(exclusive).toHaveBeenCalledTimes(1);
    expect(w.leaves.get(ROOT)?.size ?? 0).toBe(0);
    expect(w.buckets.get(ROOT)?.size ?? 0).toBe(0);
    expect(w.roots.has(ROOT)).toBe(false);
  });
});

describe('M2: skipped bodies are re-verified under the lock', () => {
  it('a body whose index row the sweep removed after the pre-check is 409 extracted_missing and writes nothing', async () => {
    const rows = rowsFor(1, 0);
    await apply(packOf(rows));
    const hash = rows.files[0]!.hash;
    const again: Pack = { rootId: ROOT, baseGeneration: 1, files: rows.files, targetDigest: ZERO_DIGEST };
    const sweeping: ApplyDeps['atomically'] = (work) => atomically(w)(async (unit) => { w.index.delete(hash); return work(unit); });
    await expect(apply(again, { atomically: sweeping })).rejects.toMatchObject({ status: 409, code: 'extracted_missing', detail: { hashes: [hash] } });
    expect(w.roots.get(ROOT)!.generation).toBe(1);
  });
});

describe('M3: a cascaded relation delete takes this root\'s leaf with it', () => {
  it('removes the leaf and recomputes its bucket, so the digest is the one the client reaches', async () => {
    const shared = rel('fact:x', 'fact:y', 'related');
    const solo = rel('fact:x', 'fact:z', 'cites');
    const rowsA: Rows = { files: [{ path: 'src/a.ts', hash: hashOf(1), bytes: 1 }], facts: [factOf('x', 'src/a.ts')], relations: [shared, solo] };
    const rowsB: Rows = { files: [{ path: 'src/b.ts', hash: hashOf(2), bytes: 1 }], facts: [factOf('y', 'src/b.ts')], relations: [shared] };
    await apply(packOf(rowsA, { root: A }));
    await apply(packOf(rowsB, { root: B }));

    const del: Pack = { rootId: A, baseGeneration: 1, deletes: { files: [], facts: ['x'], relations: [] }, targetDigest: ZERO_DIGEST };
    const res = await apply(del);
    if (!res.applied) throw new Error('unreachable');
    expect(w.relations.has(relationLeafKey(solo))).toBe(false);
    // A's leaves: its file and the relation B also names (kept); the fact's leaf (tombstone) and the cascaded relation's leaf are gone.
    expect([...w.leaves.get(A)!.keys()].sort()).toEqual([fileLeafKey('src/a.ts', hashOf(1)), relationLeafKey(shared)].sort());
    // The digest is over A's remaining leaves, as the codec computes it. (`rootDigestOf` cannot be used: with the fact gone, `shared`
    // no longer touches A's rows by its rules, though the server's leaf for it stays.)
    const remaining = [{ key: fileLeafKey('src/a.ts', hashOf(1)), digest: hashOf(1) }, { key: relationLeafKey(shared), digest: relationDigest(shared) }];
    expect(res.digest).toBe(manifestTree(remaining).root);
  });
});

describe('L5: the manifest answers at one generation', () => {
  it('a pack that commits between the reads makes the read repeat, so generation and digest belong together', async () => {
    const rows = rowsFor(2, 0);
    await apply(packOf(rows));
    const next = { ...rows, files: [...rows.files, { path: 'src/more.ts', hash: hashOf(9), bytes: 1 }] };
    const ledger = fakeLedger(w);
    let raced = false;
    const racing = {
      ...ledger,
      buckets: {
        ...ledger.buckets,
        digests: async (root: string) => {
          const old = await ledger.buckets.digests(root);
          if (!raced) { raced = true; await apply({ rootId: ROOT, baseGeneration: 1, files: [next.files[2]!], extracted: [{ kind: 'full', hash: hashOf(9), entries: [extraction(ROOT, 'src/more.ts', hashOf(9))] }], targetDigest: ZERO_DIGEST }); }
          return old;
        },
      },
    };
    const answer = await decodePack(await manifestSummary({ sync: fakeSync(w), ledger: racing }, ROOT));
    expect(answer.baseGeneration).toBe(2);
    expect(answer.targetDigest).toBe(w.roots.get(ROOT)!.digest);
  });

  it('the leaf request is answered the same way', async () => {
    await apply(packOf(rowsFor(2, 0)));
    const answer = await decodePack(await manifestLeaves({ sync: fakeSync(w), ledger: fakeLedger(w) }, ROOT, [0, 1, 2]));
    expect(answer.baseGeneration).toBe(1);
  });
});

describe('L2: have pairs and ids refuse what Postgres would 500 on', () => {
  const body = (sourceRef: string) =>
    encodePack({ rootId: ROOT, baseGeneration: 0, targetDigest: ZERO_DIGEST, stale: [{ sourceRef: sourceRef as never, hash: hashOf(1) }] });

  it('a NUL or control character in a sourceRef is 422, not a jsonb 500', async () => {
    await expect(haveBitmap({ sync: fakeSync(w) }, await body('src:ws:test::a\u0000b'))).rejects.toMatchObject({ status: 422, code: 'bad_pack' });
    await expect(haveBitmap({ sync: fakeSync(w) }, await body('src:ws:test::a\u0007b'))).rejects.toMatchObject({ status: 422, code: 'bad_pack' });
  });

  it('a lone surrogate or a malformed hash in a pair is 422', () => {
    expect(() => checkHavePairs([{ hash: hashOf(1), sourceRef: 'src:r::a\uD800' }])).toThrowError(/lone surrogate/);
    expect(() => checkHavePairs([{ hash: 'bad hash!', sourceRef: 'src:r::a' }])).toThrowError(/content hash/);
    expect(() => checkHavePairs([{ hash: hashOf(1), sourceRef: 'src:r::a\u{1F600}' }])).not.toThrow();
  });
});

describe('L3: fact content', () => {
  it('a NUL in a fact\'s content is 422 bad_pack, and nothing is written', async () => {
    const rows = rowsFor(1, 0);
    const bad = { ...rows, facts: [factOf('claim:0', rows.files[0]!.path, 'bad\u0000content')] };
    await expect(apply(packOf(bad))).rejects.toMatchObject({ status: 422, code: 'bad_pack' });
    expect(w.puts).toEqual([]);
    expect(w.roots.size).toBe(0);
  });
});
