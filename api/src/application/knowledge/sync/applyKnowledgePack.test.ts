/**
 * applyKnowledgePack (PRD 41 A11): the happy path, the generation and digest checks (409), a zip bomb (413),
 * a corrupt frame (422), multi-part staging, and the reconcile / have / within-file-diff halves.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  diffEntries, encodePack, manifestTree, rootDigestOf, rootLeaves, splitParts, ZERO_DIGEST, differingBuckets, leafDelta,
  type Pack, type PackFileRow,
} from '@seanhogg/builderforce-memory/knowledge/pack';
import type { Extracted, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import { newWorld, fakeStore, fakeExtracted, fakeSync, type World } from './syncFakes.test-util';

const held = vi.hoisted(() => ({ world: null as null | { facts: Map<string, unknown> } }));
vi.mock('../../llm/projectFactsWrite', () => ({
  upsertProjectFact: vi.fn(async (_e: unknown, _d: unknown, _t: unknown, _p: unknown, key: string, content: string, source: string, opts: { fileAnchors?: unknown[]; factOrigin?: string }) => {
    held.world!.facts.set(key, { key, content, source, importance: 0.5, origin: opts.factOrigin ?? 'model', fileAnchors: opts.fileAnchors ?? [] });
    return true;
  }),
  deleteProjectFact: vi.fn(async (_e: unknown, _d: unknown, _t: unknown, _p: unknown, key: string) => held.world!.facts.delete(key)),
}));
vi.mock('../knowledgeVersion', () => ({ bumpKnowledgeVersion: vi.fn(async () => undefined), knowledgeVersion: vi.fn() }));

import { applyKnowledgePack, type ApplyDeps } from './applyKnowledgePack';
import { bucketIdsOf, haveBitmap, manifestLeaves, manifestSummary } from './knowledgeSyncManifest';
import { KnowledgeSyncError } from './knowledgeSyncPorts';
import { decodePack } from '@seanhogg/builderforce-memory/knowledge/pack';

const ROOT = 'ws:test';
const ref = (p: string): `src:${string}` => `src:${ROOT}::${p}`;
const hashOf = (i: number): string => i.toString(16).padStart(64, 'a');

let w: World;
const deps = (): ApplyDeps => ({
  env: {} as never, db: {} as never, tenantId: 1, projectId: 2, userId: 'u1', actorRole: 'developer',
  store: fakeStore(w), extracted: fakeExtracted(w), sync: fakeSync(w),
});

const extraction = (path: string, hash: string, symbols = 3): Extracted => ({
  sourceRef: ref(path), sourceHash: hash,
  nodes: [{ ref: ref(path), kind: 'file', label: path, pack: 'code', importance: 0.5, origin: 'extracted', sourceHash: hash },
    ...Array.from({ length: symbols }, (_, s) => ({ ref: ref(`${path}#s${s}`), kind: 'symbol', label: `s${s}`, pack: 'code', importance: 0.1, origin: 'extracted' as const, sourceHash: hash }))],
  edges: [], keys: [],
});

function build(n: number, generation = 0): Pack {
  const files: PackFileRow[] = Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.ts`, hash: hashOf(i + 1), bytes: 100 + i }));
  const facts: StoredFact[] = files.slice(0, 2).map((f, i) => ({ key: `claim:${i}`, content: `fact ${i}`, source: 'review', importance: 0.5, origin: 'model', fileAnchors: [{ path: f.path }] }));
  const relations: StoredRelation[] = [{ from: ref('src/f0.ts'), to: 'fact:claim:0', kind: 'about', weight: 1, origin: 'model', sourceHash: files[0]!.hash }];
  return {
    rootId: ROOT, baseGeneration: generation, files, facts, relations,
    extracted: files.map((f) => ({ kind: 'full' as const, hash: f.hash, entries: [extraction(f.path, f.hash)] })),
    targetDigest: rootDigestOf(ROOT, { files, facts, relations }),
  };
}

const deflateRaw = async (b: Uint8Array): Promise<Uint8Array> => {
  const cs = new CompressionStream('deflate-raw');
  const wr = cs.writable.getWriter();
  void wr.write(b as never).then(() => wr.close());
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
};

beforeEach(() => { w = newWorld(); held.world = w; });

describe('applyKnowledgePack', () => {
  it('applies a full pack, answers {generation, digest}, then a delta at that generation', async () => {
    const first = build(5);
    const res = await applyKnowledgePack(deps(), { body: await encodePack(first) });
    expect(res).toMatchObject({ applied: true, generation: 1, digest: first.targetDigest, facts: 2, relations: 1 });
    expect(w.sources.size).toBe(5);
    expect(w.bodies.size).toBe(5);

    const files = [...first.files!.slice(0, 4), { path: 'src/new.ts', hash: hashOf(99), bytes: 5 }];
    const next: Pack = {
      rootId: ROOT, baseGeneration: 1, files: [files[4]!], extracted: [{ kind: 'full', hash: hashOf(99), entries: [extraction('src/new.ts', hashOf(99))] }],
      deletes: { files: ['src/f4.ts'], facts: [], relations: [] },
      targetDigest: rootDigestOf(ROOT, { files, facts: first.facts!, relations: first.relations! }),
    };
    expect(await applyKnowledgePack(deps(), { body: await encodePack(next) })).toMatchObject({ applied: true, generation: 2 });
    expect(w.sources.has('src/f4.ts')).toBe(false);
    expect(w.sources.get('src/new.ts')).toBe(hashOf(99));
  });

  it('answers 409 generation_mismatch for a stale baseGeneration and changes nothing', async () => {
    await applyKnowledgePack(deps(), { body: await encodePack(build(3)) });
    const before = w.sources.size;
    const stale = { ...build(4), baseGeneration: 7 };
    await expect(applyKnowledgePack(deps(), { body: await encodePack(stale) })).rejects.toMatchObject({ status: 409, code: 'generation_mismatch', detail: { generation: 1 } });
    expect(w.sources.size).toBe(before);
  });

  it('answers 409 digest_mismatch and does not advance the generation', async () => {
    const pack = { ...build(3), targetDigest: 'f'.repeat(64) };
    await expect(applyKnowledgePack(deps(), { body: await encodePack(pack) })).rejects.toMatchObject({ status: 409, code: 'digest_mismatch' });
    expect(w.state.get(ROOT)).toBeUndefined();
  });

  it('answers 413 for a body over 8 MB and for a bomb', async () => {
    await expect(applyKnowledgePack(deps(), { body: new Uint8Array(8 * 1024 * 1024 + 1) })).rejects.toMatchObject({ status: 413 });
    const real = await encodePack(build(1), { deflate: false });
    // A frame header (magic, version, flags=deflated, root, generation, digest) over a 70 MB zero body, deflated.
    const header = real.slice(0, 4 + 1 + 1 + 1 + ROOT.length + 1 + 32);
    header[5] = 1;
    const zeros = new Uint8Array(70 * 1024 * 1024);
    const stored = await deflateRaw(zeros);
    const bomb = new Uint8Array(header.length + stored.length + 4);
    bomb.set(header); bomb.set(stored, header.length);
    await expect(applyKnowledgePack(deps(), { body: bomb })).rejects.toMatchObject({ status: 413, code: 'pack_too_large' });
  }, 60_000);

  it('answers 422 bad_pack for a corrupt frame', async () => {
    const bytes = await encodePack(build(3), { deflate: false });
    bytes[Math.floor(bytes.length / 2)]! ^= 0x55;
    await expect(applyKnowledgePack(deps(), { body: bytes })).rejects.toMatchObject({ status: 422, code: 'bad_pack' });
    await expect(applyKnowledgePack(deps(), { body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40]) })).rejects.toBeInstanceOf(KnowledgeSyncError);
  });

  it('stages parts by syncId and applies only when the last arrives', async () => {
    const pack = build(6);
    const bytes = await encodePack(pack);
    const parts = splitParts(bytes, Math.ceil(bytes.length / 3));
    expect(parts.length).toBe(3);
    const syncId = 'sync-abcdef12';
    for (let i = 0; i < parts.length - 1; i++) {
      expect(await applyKnowledgePack(deps(), { body: parts[i]!, syncId, part: i, parts: parts.length })).toMatchObject({ applied: false, received: i + 1 });
      expect(w.sources.size).toBe(0);
    }
    expect(await applyKnowledgePack(deps(), { body: parts[2]!, syncId, part: 2, parts: 3 })).toMatchObject({ applied: true, generation: 1 });
    expect(w.sources.size).toBe(6);
    expect(w.staged.size).toBe(0);
  });

  it('rejects a multi-part request that names no valid syncId, and a missing earlier part', async () => {
    await expect(applyKnowledgePack(deps(), { body: new Uint8Array(4), syncId: 'x', part: 0, parts: 2 })).rejects.toMatchObject({ status: 400 });
    await expect(applyKnowledgePack(deps(), { body: new Uint8Array(4), syncId: 'sync-abcdef12', part: 1, parts: 2 })).rejects.toMatchObject({ status: 409, code: 'parts_missing' });
  });

  it('expands a within-file diff against the prior the server holds, and refuses one without the prior', async () => {
    const first = build(2);
    await applyKnowledgePack(deps(), { body: await encodePack(first) });
    const prior = first.extracted![0]!;
    const priorEntry = (prior as { entries: Extracted[] }).entries[0]!;
    const newHash = hashOf(500);
    const next: Extracted = { ...extraction('src/f0.ts', newHash, 4), };
    const diffs = diffEntries([priorEntry], [next])!;
    const files = [{ path: 'src/f0.ts', hash: newHash, bytes: 9 }, first.files![1]!];
    const delta: Pack = {
      rootId: ROOT, baseGeneration: 1, files: [files[0]!],
      extracted: [{ kind: 'diff', hash: newHash, prior: first.files![0]!.hash, entries: diffs }],
      targetDigest: rootDigestOf(ROOT, { files, facts: first.facts!, relations: first.relations! }),
    };
    expect(await applyKnowledgePack(deps(), { body: await encodePack(delta) })).toMatchObject({ applied: true, generation: 2 });
    expect(w.bodies.get(newHash)).toEqual([next]);
    expect(w.stale).toContain(`${ref('src/f0.ts')}@${newHash}`);

    const orphan: Pack = { ...delta, baseGeneration: 2, extracted: [{ kind: 'diff', hash: hashOf(501), prior: hashOf(777), entries: diffs }] };
    await expect(applyKnowledgePack(deps(), { body: await encodePack(orphan) })).rejects.toMatchObject({ status: 409, code: 'prior_missing' });
  });
});

describe('reconcile and have', () => {
  it('two clients with equal state: equal root digests, so nothing to send', async () => {
    const pack = build(8);
    await applyKnowledgePack(deps(), { body: await encodePack(pack) });
    const summary = await decodePack(await manifestSummary({ store: fakeStore(w), sync: fakeSync(w) }, ROOT));
    expect(summary.targetDigest).toBe(pack.targetDigest);
    expect(summary.baseGeneration).toBe(1);
    expect(differingBuckets(summary.buckets!, manifestTree(rootLeaves(ROOT, { files: pack.files!, facts: pack.facts!, relations: pack.relations! })).buckets)).toEqual([]);
  });

  it('a re-linked root with 3 changed files: only the differing buckets are asked for, and the delta is those files', async () => {
    const pack = build(60);
    await applyKnowledgePack(deps(), { body: await encodePack(pack) });
    const files = pack.files!.map((f, i) => (i < 3 ? { ...f, hash: hashOf(1000 + i) } : f));
    const local = manifestTree(rootLeaves(ROOT, { files, facts: pack.facts!, relations: pack.relations! }));
    const m = { store: fakeStore(w), sync: fakeSync(w) };
    const server = await decodePack(await manifestSummary(m, ROOT));
    const differing = differingBuckets(local.buckets, server.buckets!);
    expect(differing.length).toBeGreaterThan(0);
    expect(differing.length).toBeLessThanOrEqual(3);
    const ask = await encodePack({ rootId: ROOT, baseGeneration: 0, targetDigest: ZERO_DIGEST, leaves: differing.map((b) => ({ key: `b:${b}`, digest: ZERO_DIGEST })) });
    const { rootId, buckets } = await bucketIdsOf(ask);
    const answer = await decodePack(await manifestLeaves(m, rootId, buckets));
    const delta = leafDelta(local, answer.leaves ?? [], differing);
    expect(delta.upsert.sort()).toEqual(files.slice(0, 3).map((f) => `f:${f.path}`).sort());
    expect(delta.remove).toEqual([]);
  });

  it('answers a bitmap of the hashes the project holds, under any root', async () => {
    await applyKnowledgePack(deps(), { body: await encodePack(build(3)) });
    const ask = [hashOf(2), hashOf(40), hashOf(1)];
    const body = await encodePack({ rootId: ROOT, baseGeneration: 0, targetDigest: ZERO_DIGEST, hashes: ask });
    const bits = await haveBitmap({ sync: fakeSync(w) }, body);
    const order = [...ask].sort();
    const has = order.map((_, i) => (bits[i >> 3]! >> (i & 7)) & 1);
    expect(order.map((h, i) => [h, has[i]])).toEqual(order.map((h) => [h, h === hashOf(40) ? 0 : 1]));
  });
});
