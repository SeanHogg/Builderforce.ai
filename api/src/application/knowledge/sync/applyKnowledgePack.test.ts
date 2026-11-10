/**
 * applyKnowledgePack (PRD 41 A11): the happy path, the guards (generation, digest, size, parts, malformed, bombs),
 * storage bounds (objects per pack), rollback, the diff / have / reconcile halves. Cross-root behaviour, tombstones
 * and convergence are in applyKnowledgePack.roots.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  diffEntries, encodePack, manifestTree, rootLeaves, splitParts, ZERO_DIGEST, differingBuckets, leafDelta, decodePack, rootDigestOf,
  type Pack,
} from '@seanhogg/builderforce-memory/knowledge/pack';
import { atomically, newWorld, fakeStore, fakeExtracted, fakeLedger, fakeSync, type World } from './syncFakes.test-util';
import { extraction, hashOf, packOf, refOf, ROOT, rowsFor } from './packFixtures.test-util';

const held = vi.hoisted(() => ({ world: null as null | { facts: Map<string, unknown> } }));
vi.mock('../../llm/projectFactsWrite', () => ({
  // The fact writer's batch call: every fact lands in the world in ONE call (PRD 41 A11 rule 4a).
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
import { bucketIdsOf, haveBitmap, manifestLeaves, manifestSummary } from './knowledgeSyncManifest';

let w: World;
const deps = (over: Partial<ApplyDeps> = {}): ApplyDeps => ({
  env: {} as never, db: {} as never, tenantId: 1, projectId: 2, userId: 'u1', actorRole: 'developer',
  store: fakeStore(w), extracted: fakeExtracted(w), sync: fakeSync(w), ledger: fakeLedger(w), atomically: atomically(w), ...over,
});
const manifestDeps = () => ({ sync: fakeSync(w), ledger: fakeLedger(w) });
const apply = async (pack: Pack, d: Partial<ApplyDeps> = {}) => applyKnowledgePack(deps(d), { body: await encodePack(pack) });

const deflateRaw = async (b: Uint8Array): Promise<Uint8Array> => {
  const cs = new CompressionStream('deflate-raw');
  const wr = cs.writable.getWriter();
  void wr.write(b as never).then(() => wr.close());
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
};

beforeEach(() => { w = newWorld(); held.world = w as never; });

describe('applyKnowledgePack', () => {
  it('applies a full pack, answers {generation, digest}, records the root\'s leaves, then applies a delta at that generation', async () => {
    const rows = rowsFor(5);
    const res = await apply(packOf(rows));
    expect(res).toMatchObject({ applied: true, generation: 1, digest: rootDigestOf(ROOT, rows), facts: 2, relations: 1 });
    expect(w.sources.get(ROOT)!.size).toBe(5);
    expect(w.index.size).toBe(5);
    expect(w.bundles.size).toBe(1); // the pack's bodies are ONE object
    expect(w.leaves.get(ROOT)!.size).toBe(5 + 2 + 1);
    expect(w.roots.get(ROOT)).toMatchObject({ generation: 1 });

    const after = { ...rows, files: [...rows.files.slice(0, 4), { path: 'src/new.ts', hash: hashOf(99), bytes: 5 }] };
    const delta: Pack = {
      rootId: ROOT, baseGeneration: 1, files: [after.files[4]!], extracted: [{ kind: 'full', hash: hashOf(99), entries: [extraction(ROOT, 'src/new.ts', hashOf(99))] }],
      deletes: { files: ['src/f4.ts'], facts: [], relations: [] }, targetDigest: rootDigestOf(ROOT, after),
    };
    expect(await apply(delta)).toMatchObject({ applied: true, generation: 2 });
    expect(w.sources.get(ROOT)!.get('src/f4.ts')?.hash).toBe(''); // a removal is a marker row
    expect(w.sources.get(ROOT)!.get('src/new.ts')?.hash).toBe(hashOf(99));
  });

  it('answers 409 generation_mismatch for a stale baseGeneration BEFORE inflating, and changes nothing', async () => {
    await apply(packOf(rowsFor(3)));
    const before = w.sources.get(ROOT)!.size;
    const stale = packOf(rowsFor(4), { generation: 7 });
    await expect(apply(stale)).rejects.toMatchObject({ status: 409, code: 'generation_mismatch', detail: { generation: 1 } });
    expect(w.sources.get(ROOT)!.size).toBe(before);
    // Garbage after a stale header is still the generation answer: the body was never read.
    const bytes = await encodePack(stale);
    const torn = bytes.slice(0, bytes.length - 20);
    await expect(applyKnowledgePack(deps(), { body: torn })).rejects.toMatchObject({ status: 409, code: 'generation_mismatch' });
  });

  it('accepts a full pack (generation 0) only while the root has no row', async () => {
    await apply(packOf(rowsFor(2)));
    await expect(apply(packOf(rowsFor(3)))).rejects.toMatchObject({ status: 409, code: 'generation_mismatch', detail: { generation: 1 } });
  });

  it('answers 409 digest_mismatch, rolls the transaction back (no rows, leaves or generation), and a right pack applies over it', async () => {
    const rows = rowsFor(3);
    await expect(apply({ ...packOf(rows), targetDigest: 'f'.repeat(64) })).rejects.toMatchObject({ status: 409, code: 'digest_mismatch' });
    expect(w.roots.has(ROOT)).toBe(false);
    expect(w.sources.get(ROOT)?.size ?? 0).toBe(0);
    expect(w.index.size).toBe(0);
    expect(w.leaves.get(ROOT)?.size ?? 0).toBe(0);
    expect(w.facts.size).toBe(0);
    expect(w.relations.size).toBe(0);
    // The bundle was written before the transaction: an orphan, harmless (content-addressed) and swept by age.
    expect(w.bundles.size).toBe(1);
    expect(await apply(packOf(rows))).toMatchObject({ applied: true, generation: 1 });
  });

  it('answers 413 for a body over 8 MB and for a zip bomb, 422 for a corrupt or flipped frame', async () => {
    await expect(applyKnowledgePack(deps(), { body: new Uint8Array(8 * 1024 * 1024 + 1) })).rejects.toMatchObject({ status: 413 });
    const real = await encodePack(packOf(rowsFor(1)), { deflate: false });
    const header = real.slice(0, 4 + 1 + 1 + 1 + ROOT.length + 1 + 32);
    header[5] = 1;
    const zeros = new Uint8Array(70 * 1024 * 1024);
    const stored = await deflateRaw(zeros);
    const bomb = new Uint8Array(header.length + stored.length + 4);
    bomb.set(header); bomb.set(stored, header.length);
    await expect(applyKnowledgePack(deps(), { body: bomb })).rejects.toMatchObject({ status: 413, code: 'pack_too_large' });

    const flipped = await encodePack(packOf(rowsFor(3)), { deflate: false });
    flipped[Math.floor(flipped.length / 2)]! ^= 0x55;
    await expect(applyKnowledgePack(deps(), { body: flipped })).rejects.toMatchObject({ status: 422, code: 'bad_pack' });
    await expect(applyKnowledgePack(deps(), { body: new Uint8Array(60).fill(7) })).rejects.toMatchObject({ status: 422, code: 'bad_pack' });
  }, 60_000);

  it('refuses rows the writer cannot take with 422 bad_pack, before anything is written', async () => {
    const rows = rowsFor(3);
    const dupRel = { ...packOf(rows), relations: [...rows.relations, rows.relations[0]!] };
    await expect(apply(dupRel)).rejects.toMatchObject({ status: 422, code: 'bad_pack' });
    const dupBody = packOf(rows);
    await expect(apply({ ...dupBody, extracted: [...dupBody.extracted!, dupBody.extracted![0]!] })).rejects.toMatchObject({ status: 422 });
    await expect(apply({ ...packOf(rows), facts: [{ ...rows.facts[0]!, origin: 'human' }] })).rejects.toMatchObject({ status: 422, code: 'bad_pack' });
    await expect(apply({ ...packOf(rows), files: [{ path: 'a.ts', hash: 'not a hash!', bytes: 1 }] })).rejects.toMatchObject({ status: 422 });
    await expect(apply({ ...packOf(rows), rootId: 'r'.repeat(513) })).rejects.toMatchObject({ status: 422 });
    expect(w.puts).toEqual([]);
    expect(w.roots.size).toBe(0);
  });

  it('a first sync of 20,000 files writes at most parts + 1 objects, and the bodies are one bundle', async () => {
    const rows = rowsFor(20_000, 4);
    const bytes = await encodePack(packOf(rows));
    const parts = splitParts(bytes);
    expect(parts.length).toBe(1);
    const res = await applyKnowledgePack(deps(), { body: bytes });
    expect(res).toMatchObject({ applied: true, extracted: 20_000 });
    expect(w.sources.get(ROOT)!.size).toBe(20_000);
    expect(w.index.size).toBe(20_000);
    expect(w.puts).toEqual(['bundle']);              // no per-hash, no per-source object; the generation is a ROW
    expect(w.puts.length).toBeLessThanOrEqual(parts.length + 1);
  }, 120_000);

  it('a multi-part pack costs its earlier parts and one bundle', async () => {
    const bytes = await encodePack(packOf(rowsFor(300)));
    const parts = splitParts(bytes, Math.ceil(bytes.length / 3));
    expect(parts.length).toBe(3);
    for (let i = 0; i < parts.length; i++) await applyKnowledgePack(deps(), { body: parts[i]!, syncId: 'sync-parts-0001', part: i, parts: parts.length });
    expect(w.puts).toEqual(['stage', 'stage', 'bundle']);
    expect(w.puts.length).toBeLessThanOrEqual(parts.length + 1);
    expect(w.staged.size).toBe(0);
    expect(w.roots.get(ROOT)).toMatchObject({ generation: 1 });
  });

  it('refuses a 9-part pack, a bad syncId, and a missing earlier part', async () => {
    await expect(applyKnowledgePack(deps(), { body: new Uint8Array(4), syncId: 'sync-nine-0001', part: 0, parts: 9 })).rejects.toMatchObject({ status: 400, code: 'bad_parts' });
    await expect(applyKnowledgePack(deps(), { body: new Uint8Array(4), syncId: 'x', part: 0, parts: 2 })).rejects.toMatchObject({ status: 400 });
    await expect(applyKnowledgePack(deps(), { body: new Uint8Array(4), syncId: 'sync-abcdef12', part: 1, parts: 2 })).rejects.toMatchObject({ status: 409, code: 'parts_missing' });
    // 8 parts is the most a pack may have.
    await expect(applyKnowledgePack(deps(), { body: new Uint8Array(4), syncId: 'sync-eight-0001', part: 0, parts: 8 })).resolves.toMatchObject({ applied: false, parts: 8 });
  });

  it('one actor\'s syncId is not another\'s: staged parts are keyed by the actor', async () => {
    const bytes = await encodePack(packOf(rowsFor(100)));
    const parts = splitParts(bytes, Math.ceil(bytes.length / 2));
    await applyKnowledgePack(deps({ userId: 'u1' }), { body: parts[0]!, syncId: 'shared-sync-01', part: 0, parts: 2 });
    await expect(applyKnowledgePack(deps({ userId: 'u2' }), { body: parts[1]!, syncId: 'shared-sync-01', part: 1, parts: 2 })).rejects.toMatchObject({ status: 409, code: 'parts_missing' });
    await expect(applyKnowledgePack(deps({ userId: 'u1' }), { body: parts[1]!, syncId: 'shared-sync-01', part: 1, parts: 2 })).resolves.toMatchObject({ applied: true });
  });

  it('records a review snapshot after the commit, only when the scope states a new digest', async () => {
    const pack = { ...packOf(rowsFor(3)), scope: { rootId: ROOT, title: 't', packs: ['code'], lastDigest: 'abcdef12' } };
    await apply(pack);
    expect(w.puts).toEqual(['bundle', `snapshot:${ROOT}:abcdef12`]);
  });

  it('writes what the review was measured with — read from the pack\'s own scope — onto the scope it records (PRD 41 §C9)', async () => {
    const scopes: unknown[] = [];
    const tx = atomically(w);
    const spying = (<T>(work: (unit: Parameters<Parameters<typeof tx>[0]>[0]) => Promise<T>) => tx((unit) => {
      unit.store.upsertScope = async (s) => { scopes.push(s); };
      return work(unit);
    })) as ApplyDeps['atomically'];
    const measured = { extractorVersion: '5', toolVersions: { knip: '5.30.0' } };
    const pack = { ...packOf(rowsFor(3)), scope: { rootId: ROOT, title: 't', packs: ['code'], lastDigest: 'abcdef12', measured } };
    await applyKnowledgePack(deps({ atomically: spying }), { body: await encodePack(pack) });
    expect(scopes).toEqual([expect.objectContaining({ rootId: ROOT, lastDigest: 'abcdef12', measured })]);
  });

  it.each([
    ['an extractor version over 64 characters', { extractorVersion: 'x'.repeat(65), toolVersions: {} }],
    ['more than 32 tools', { extractorVersion: '5', toolVersions: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`t${i}`, '1'])) }],
    ['an empty tool version', { extractorVersion: '5', toolVersions: { knip: '' } }],
  ])('refuses a pack whose scope states %s with 422 bad_pack, before anything is written', async (_case, measured) => {
    const pack = { ...packOf(rowsFor(2)), scope: { rootId: ROOT, title: 't', packs: ['code'], lastDigest: 'abcdef12', measured } };
    await expect(apply(pack)).rejects.toMatchObject({ status: 422, code: 'bad_pack' });
    expect(w.roots.size).toBe(0);
  });

  it('answers 413 for an oversized analysis BEFORE the transaction: nothing is written', async () => {
    const pack = { ...packOf(rowsFor(2)), analysis: { sha: 'abc123', snapshot: { blob: 'x'.repeat(2.2 * 1024 * 1024) } } };
    await expect(apply(pack)).rejects.toMatchObject({ status: 413 });
    expect(w.roots.size).toBe(0);
    expect(w.puts).toEqual([]);
  }, 30_000);
});

describe('bodies', () => {
  it('reads a stored body through the index with a ranged read, and falls back to the legacy per-hash object', async () => {
    const rows = rowsFor(4);
    await apply(packOf(rows));
    const store = fakeExtracted(w);
    expect(await store.get(rows.files[2]!.hash)).toEqual([extraction(ROOT, rows.files[2]!.path, rows.files[2]!.hash)]);
    expect(w.bundleReads).toBe(1);
    const legacy = extraction(ROOT, 'src/legacy.ts', hashOf(777));
    w.legacyBodies.set(hashOf(777), [legacy]);
    expect(await store.get(hashOf(777))).toEqual([legacy]);
    expect(await store.get(hashOf(778))).toBeUndefined();
  });

  it('expands a within-file diff against the prior the server holds; a missing prior and a malformed diff are 409 prior_missing', async () => {
    const rows = rowsFor(2);
    await apply(packOf(rows));
    const prior = extraction(ROOT, 'src/f0.ts', rows.files[0]!.hash);
    const newHash = hashOf(500);
    const next = extraction(ROOT, 'src/f0.ts', newHash, 4);
    const diffs = diffEntries([prior], [next])!;
    const after = { ...rows, files: [{ path: 'src/f0.ts', hash: newHash, bytes: 9 }, rows.files[1]!] };
    const delta: Pack = {
      rootId: ROOT, baseGeneration: 1, files: [after.files[0]!],
      extracted: [{ kind: 'diff', hash: newHash, prior: rows.files[0]!.hash, entries: diffs }], targetDigest: rootDigestOf(ROOT, after),
    };
    expect(await apply(delta)).toMatchObject({ applied: true, generation: 2 });
    expect(await fakeExtracted(w).get(newHash)).toEqual([next]);
    expect(w.stale).toContain(`${refOf(ROOT, 'src/f0.ts')}@${newHash}`);

    const orphan: Pack = { ...delta, baseGeneration: 2, extracted: [{ kind: 'diff', hash: hashOf(501), prior: hashOf(777), entries: diffs }] };
    await expect(apply(orphan)).rejects.toMatchObject({ status: 409, code: 'prior_missing' });

    const malformed = { ...diffs[0]!, nodes: { remove: [], add: [{ at: 99, item: diffs[0]!.nodes.add[0]?.item ?? next.nodes[0]! }] } };
    const bad: Pack = { ...delta, baseGeneration: 2, extracted: [{ kind: 'diff', hash: hashOf(502), prior: rows.files[0]!.hash, entries: [malformed] }] };
    await expect(apply(bad)).rejects.toMatchObject({ status: 409, code: 'prior_missing' });
  });

  it('verifies the bodies a pack leaves out with ONE query: a held hash that does not name the file is extracted_missing', async () => {
    const rows = rowsFor(3);
    await apply(packOf(rows));
    const copy = { path: 'src/copy.ts', hash: rows.files[1]!.hash, bytes: 1 };
    const pack: Pack = { rootId: ROOT, baseGeneration: 1, files: [copy], targetDigest: ZERO_DIGEST };
    w.indexQueries = 0;
    await expect(apply(pack)).rejects.toMatchObject({ status: 409, code: 'extracted_missing', detail: { hashes: [copy.hash] } });
    expect(w.indexQueries).toBe(1);
  });

  it('regression: an empty full body (nothing was extracted, a binary file) is recorded, so a later pack that omits the file passes verifyBodies and the body reads back as []', async () => {
    const rows = rowsFor(2);
    await apply(packOf(rows));
    const bin = { path: 'assets/logo.png', hash: hashOf(900), bytes: 10 };
    const none: Pack = { rootId: ROOT, baseGeneration: 1, files: [bin], extracted: [{ kind: 'full', hash: bin.hash, entries: [] }], targetDigest: ZERO_DIGEST };
    expect(await apply(none)).toMatchObject({ applied: true, generation: 2, extracted: 1 });
    const pair = [{ hash: bin.hash, sourceRef: refOf(ROOT, bin.path) }];
    expect(await fakeSync(w).heldEntries(pair, undefined, { entryless: true })).toEqual(new Set([0])); // verifyBodies accepts it
    expect(await fakeSync(w).heldEntries(pair)).toEqual(new Set()); // but it is never a have-answer: a real body is still asked for
    expect(await fakeExtracted(w).getMany!([bin.hash])).toEqual(new Map([[bin.hash, []]]));

    const again: Pack = { rootId: ROOT, baseGeneration: 2, files: [bin], targetDigest: ZERO_DIGEST };
    expect(await apply(again)).toMatchObject({ applied: true, generation: 3 });
  });

  it('regression: an index row whose stored body cannot be read is healed (no 409): the arrival is written alone and the index names only its sources, so the other pairs re-upload', async () => {
    const rows = rowsFor(1);
    await apply(packOf(rows));
    const shared = rows.files[0]!;
    w.bundles.clear(); // the object behind the index row is gone
    const copy = { path: 'src/copy.ts', hash: shared.hash, bytes: 1 };
    const pack: Pack = { rootId: ROOT, baseGeneration: 1, files: [copy], extracted: [{ kind: 'full', hash: shared.hash, entries: [extraction(ROOT, copy.path, shared.hash)] }], targetDigest: ZERO_DIGEST };
    // The pack advances the root to 2; the root's OWN src/f0.ts still names the lost hash and the pack did not re-supply it, so the heal
    // invalidates that leaf too (generation 3) and tells the client to reconcile.
    expect(await apply(pack)).toMatchObject({ applied: true, generation: 3, reconcile: true });
    expect(w.index.get(shared.hash)!.sourceRefs).toEqual([refOf(ROOT, copy.path)]); // the lost body's old sources are no longer claimed
    expect(await fakeSync(w).heldEntries([{ hash: shared.hash, sourceRef: refOf(ROOT, rows.files[0]!.path) }])).toEqual(new Set()); // so that pair is asked for again
  });

  it('regression: the same bytes at two paths (a .png and a .txt) with an empty body: each path gets its OWN entry-less marker, so neither is re-shipped as owed', async () => {
    await apply(packOf(rowsFor(1)));
    const png = { path: 'assets/a.png', hash: hashOf(902), bytes: 5 };
    const txt = { path: 'assets/a.txt', hash: hashOf(902), bytes: 5 };
    await apply({ rootId: ROOT, baseGeneration: 1, files: [png, txt], extracted: [{ kind: 'full', hash: png.hash, entries: [] }], targetDigest: ZERO_DIGEST });
    const pairs = [png, txt].map((f) => ({ hash: f.hash, sourceRef: refOf(ROOT, f.path) }));
    expect(await fakeSync(w).heldEntries(pairs, undefined, { entryless: true })).toEqual(new Set([0, 1]));
    expect(await fakeSync(w).heldEntries(pairs)).toEqual(new Set()); // never a have-answer
  });

  it('regression: a real body arriving later for an entry-less pair is stored, and the pair stops being entry-less', async () => {
    await apply(packOf(rowsFor(1)));
    const bin = { path: 'src/late.ts', hash: hashOf(901), bytes: 10 };
    await apply({ rootId: ROOT, baseGeneration: 1, files: [bin], extracted: [{ kind: 'full', hash: bin.hash, entries: [] }], targetDigest: ZERO_DIGEST });
    const real = extraction(ROOT, bin.path, bin.hash);
    await apply({ rootId: ROOT, baseGeneration: 2, files: [bin], extracted: [{ kind: 'full', hash: bin.hash, entries: [real] }], targetDigest: ZERO_DIGEST });
    expect(await fakeExtracted(w).get(bin.hash)).toEqual([real]);
    expect(await fakeSync(w).heldEntries([{ hash: bin.hash, sourceRef: refOf(ROOT, bin.path) }])).toEqual(new Set([0]));
    expect(w.index.get(bin.hash)!.sourceRefs).toEqual([refOf(ROOT, bin.path)]); // no entry-less marker left behind
  });
});

describe('manifest, leaves and have', () => {
  it('two clients with equal state: equal root digests, so nothing to send; the tree comes from the leaves only', async () => {
    const rows = rowsFor(8);
    await apply(packOf(rows));
    w.sharedTableReads = 0;
    const summary = await decodePack(await manifestSummary(manifestDeps(), ROOT));
    expect(summary.targetDigest).toBe(rootDigestOf(ROOT, rows));
    expect(summary.baseGeneration).toBe(1);
    expect(w.sharedTableReads).toBe(0);
    expect(differingBuckets(summary.buckets!, manifestTree(rootLeaves(ROOT, rows)).buckets)).toEqual([]);
  });

  it('a re-linked root with 3 changed files: only the differing buckets are asked for, and the delta is those files', async () => {
    const rows = rowsFor(60, 0);
    await apply(packOf(rows));
    const files = rows.files.map((f, i) => (i < 3 ? { ...f, hash: hashOf(1000 + i) } : f));
    const local = manifestTree(rootLeaves(ROOT, { files, facts: [], relations: [] }));
    const server = await decodePack(await manifestSummary(manifestDeps(), ROOT));
    const differing = differingBuckets(local.buckets, server.buckets!);
    expect(differing.length).toBeGreaterThan(0);
    expect(differing.length).toBeLessThanOrEqual(3);
    const ask = await encodePack({ rootId: ROOT, baseGeneration: 0, targetDigest: ZERO_DIGEST, leaves: differing.map((b) => ({ key: `b:${b}`, digest: ZERO_DIGEST })) });
    const { rootId, buckets } = await bucketIdsOf(ask);
    const answer = await decodePack(await manifestLeaves(manifestDeps(), rootId, buckets));
    const delta = leafDelta(local, answer.leaves ?? [], differing);
    expect(delta.upsert.sort()).toEqual(files.slice(0, 3).map((f) => `f:${f.path}`).sort());
    expect(delta.remove).toEqual([]);
  });

  // The have request is per (hash, sourceRef) pair, in `stale` rows; the answer's bit i is the i-th row in the codec's decoded order.
  const pairOf = (i: number) => ({ sourceRef: refOf(ROOT, `src/f${i}.ts`), hash: hashOf(i + 1) });
  const haveBody = (pairs: ReadonlyArray<{ sourceRef: string; hash: string }>) =>
    encodePack({ rootId: ROOT, baseGeneration: 0, targetDigest: ZERO_DIGEST, stale: pairs.map((p) => ({ sourceRef: p.sourceRef as never, hash: p.hash })) });
  const heldIn = (pairs: ReadonlyArray<{ sourceRef: string }>, bits: Uint8Array): string[] =>
    [...pairs].sort((a, b) => (a.sourceRef < b.sourceRef ? -1 : 1)).filter((_, i) => ((bits[i >> 3]! >> (i & 7)) & 1) === 1).map((p) => p.sourceRef);

  it('answers a bitmap of the (hash, sourceRef) pairs the project holds; a hash held under another file answers 0', async () => {
    await apply(packOf(rowsFor(3)));
    const ask = [pairOf(1), pairOf(39), pairOf(0), { sourceRef: refOf(ROOT, 'src/f2.ts'), hash: hashOf(1) }];
    const bits = await haveBitmap({ sync: fakeSync(w) }, await haveBody(ask));
    expect(heldIn(ask, bits).sort()).toEqual([pairOf(0).sourceRef, pairOf(1).sourceRef].sort());
  });

  it('a have-check with 20,000 pairs is ONE index query, never an object read per pair', async () => {
    await apply(packOf(rowsFor(50)));
    const ask = Array.from({ length: 20_000 }, (_, i) => pairOf(i));
    w.indexQueries = 0;
    w.bundleReads = 0;
    const bits = await haveBitmap({ sync: fakeSync(w) }, await haveBody(ask));
    expect(w.indexQueries).toBe(1);
    expect(w.bundleReads).toBe(0);
    expect(heldIn(ask, bits).sort()).toEqual(Array.from({ length: 50 }, (_, i) => pairOf(i).sourceRef).sort());
  });
});

