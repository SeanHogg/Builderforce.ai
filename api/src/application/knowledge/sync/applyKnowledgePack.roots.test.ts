/**
 * Pack sync is per ROOT (PRD 41 A11 rule 4b): the server's manifest is the leaves a root synced, never the shared
 * fact and relation tables. Two roots of one project never touch each other, facts converge however many there are and
 * whatever the writer does to their text, a tombstone is limited to the root's own leaves, bodies are merged by source,
 * and concurrent packs have one winner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePack, encodePack, rootDigestOf, type Pack } from '@seanhogg/builderforce-memory/knowledge/pack';
import { atomically, fakeExtracted, fakeLedger, fakeStore, fakeSync, newWorld, type World } from './syncFakes.test-util';
import { extraction, factOf, hashOf, packOf, refOf, ROOT, rowsFor, type Rows } from './packFixtures.test-util';

const held = vi.hoisted(() => ({ world: null as null | { facts: Map<string, unknown> } }));
vi.mock('../../llm/projectFactsWrite', () => ({
  // The real fact writer NORMALISES (trims, clamps, scores): this double upper-cases, so a digest taken from the
  // stored text could never match the client's. The server's leaves come from the pack's own rows.
  upsertProjectFacts: vi.fn(async (_e: unknown, _d: unknown, _t: unknown, _p: unknown, items: Array<{ key: string; content: string; source?: string; opts?: { fileAnchors?: unknown[]; factOrigin?: string } }>) => {
    for (const it of items) {
      held.world!.facts.set(it.key, { key: it.key, content: it.content.toUpperCase(), source: it.source ?? 'agent', importance: 0.9, origin: 'model', fileAnchors: it.opts?.fileAnchors ?? [], createdBy: null });
    }
    return new Set(items.map((i) => i.key));
  }),
  deleteProjectFact: vi.fn(async () => true),
}));
vi.mock('../knowledgeVersion', () => ({ bumpKnowledgeVersion: vi.fn(async () => undefined), knowledgeVersion: vi.fn() }));
vi.mock('../../../infrastructure/auth/superadminFlag', () => ({ resolveIsSuperadmin: vi.fn(async () => false) }));

import { applyKnowledgePack, type ApplyDeps } from './applyKnowledgePack';
import { manifestSummary } from './knowledgeSyncManifest';

const A = 'ws:a';
const B = 'ws:b';
const NOTHING: Rows = { files: [], facts: [], relations: [] };

let w: World;
const deps = (over: Partial<ApplyDeps> = {}): ApplyDeps => ({
  env: {} as never, db: {} as never, tenantId: 1, projectId: 2, userId: 'u1', actorRole: 'developer',
  store: fakeStore(w), extracted: fakeExtracted(w), sync: fakeSync(w), ledger: fakeLedger(w), atomically: atomically(w), ...over,
});
const apply = async (pack: Pack, over: Partial<ApplyDeps> = {}) => applyKnowledgePack(deps(over), { body: await encodePack(pack) });
const digestOf = async (root: string) => (await decodePack(await manifestSummary({ sync: fakeSync(w), ledger: fakeLedger(w) }, root))).targetDigest;

/** One shared path in two roots, and one shared fact key. */
const sharedRows = (hash: number): Rows => ({
  files: [{ path: 'src/shared.ts', hash: hashOf(hash), bytes: 1 }], facts: [factOf('claim:shared', 'src/shared.ts')], relations: [],
});

beforeEach(() => { w = newWorld(); held.world = w as never; });

describe('two roots of one project', () => {
  it('reconciling or deleting in A never touches B: tombstones are limited to the root\'s own leaves', async () => {
    const rowsA = sharedRows(1), rowsB = sharedRows(2);
    await apply(packOf(rowsA, { root: A }));
    await apply(packOf(rowsB, { root: B }));
    const before = await digestOf(B);
    expect(before).toBe(rootDigestOf(B, rowsB));

    const del: Pack = { rootId: A, baseGeneration: 1, deletes: { files: ['src/shared.ts'], facts: ['claim:shared'], relations: [] }, targetDigest: rootDigestOf(A, NOTHING) };
    const res = await apply(del);
    // A's leaves are gone; the fact ROW stays because B's leaves name it, and the answer says so.
    expect(res).toMatchObject({ applied: true, skipped: [{ key: 'a:claim:shared', reason: 'other_root' }] });
    expect(w.facts.has('claim:shared')).toBe(true);
    expect([...(w.sources.get(A)?.values() ?? [])].filter((s) => s.hash !== '')).toEqual([]); // removed = a marker row
    expect(w.sources.get(B)!.size).toBe(1);
    expect(w.leaves.get(A)?.size ?? 0).toBe(0);
    expect(await digestOf(B)).toBe(before);
    expect(await digestOf(A)).toBe(rootDigestOf(A, NOTHING));
  });

  it('a tombstone for a key the root never synced is 422 not_owned, and nothing changes', async () => {
    await apply(packOf(rowsFor(2), { root: A }));
    const gen = w.roots.get(A)!.generation;
    const ghost: Pack = { rootId: A, baseGeneration: gen, deletes: { files: ['src/ghost.ts'], facts: [], relations: [] }, targetDigest: rootDigestOf(A, rowsFor(2)) };
    await expect(apply(ghost)).rejects.toMatchObject({ status: 422, code: 'not_owned' });
    // B's key is not A's either, even with the same name.
    await apply(packOf(rowsFor(3), { root: B }));
    const other: Pack = { rootId: A, baseGeneration: gen, deletes: { files: ['src/f2.ts'], facts: [], relations: [] }, targetDigest: rootDigestOf(A, rowsFor(2)) };
    await expect(apply(other)).rejects.toMatchObject({ status: 422, code: 'not_owned' });
    expect(w.roots.get(A)!.generation).toBe(gen);
    expect(w.sources.get(B)!.size).toBe(3);
  });

  it('a fact someone else edited stays when a non-admin tombstones it: the leaf goes, the row stays, and it is reported', async () => {
    const rows = rowsFor(2, 2);
    await apply(packOf(rows));
    w.facts.get('claim:0')!.createdBy = 'someone-else';
    const after = { ...rows, facts: [rows.facts[1]!], relations: [] };
    const res = await apply({ rootId: ROOT, baseGeneration: 1, deletes: { files: [], facts: ['claim:0'], relations: [{ from: rows.relations[0]!.from, to: rows.relations[0]!.to, kind: rows.relations[0]!.kind }] }, targetDigest: rootDigestOf(ROOT, after) });
    expect(res).toMatchObject({ applied: true, skipped: [{ key: 'a:claim:0', reason: 'not_permitted' }] });
    expect(w.facts.has('claim:0')).toBe(true);
    expect(w.relations.size).toBe(0);
    expect(w.leaves.get(ROOT)!.has('a:claim:0')).toBe(false);
    // An admin may.
    w.facts.get('claim:1')!.createdBy = 'someone-else';
    const gone = await apply({ rootId: ROOT, baseGeneration: 2, deletes: { files: [], facts: ['claim:1'], relations: [] }, targetDigest: rootDigestOf(ROOT, { ...after, facts: [] }) }, { actorRole: 'manager' });
    expect(gone).toMatchObject({ applied: true, deleted: 1, skipped: [] });
    expect(w.facts.has('claim:1')).toBe(false);
  });
});

describe('convergence', () => {
  it('more than 5,000 facts converge: the server digest is the client\'s, read from the leaves, with no shared-table read', async () => {
    const rows = rowsFor(10, 6000);
    const res = await apply(packOf(rows));
    expect(res).toMatchObject({ applied: true, facts: 6000 });
    expect(res.applied && res.digest).toBe(rootDigestOf(ROOT, rows));
    w.sharedTableReads = 0;
    expect(await digestOf(ROOT)).toBe(rootDigestOf(ROOT, rows));
    expect(w.sharedTableReads).toBe(0);
    expect(w.leaves.get(ROOT)!.size).toBe(10 + 6000 + 1);
  }, 120_000);

  it('facts the writer normalised still converge: digests are the client\'s, taken from the pack, not from the stored text', async () => {
    const rows = rowsFor(3, 3);
    const res = await apply(packOf(rows));
    expect(w.facts.get('claim:0')!.content).toBe('FACT CLAIM:0');   // the store holds the normalised text
    expect(res.applied && res.digest).toBe(rootDigestOf(ROOT, rows)); // the digest does not
    expect(await digestOf(ROOT)).toBe(rootDigestOf(ROOT, rows));
  });
});

describe('concurrent packs', () => {
  it('two packs at the same generation have exactly one winner; the loser rolls back with 409 and leaves the winner intact', async () => {
    const rows = rowsFor(3, 0);
    await apply(packOf(rows));
    const edit = (n: number): Pack => {
      const f = { path: 'src/f1.ts', hash: hashOf(900 + n), bytes: 1 };
      const after = { ...rows, files: rows.files.map((x) => (x.path === f.path ? f : x)) };
      return { rootId: ROOT, baseGeneration: 1, files: [f], extracted: [{ kind: 'full', hash: f.hash, entries: [extraction(ROOT, f.path, f.hash)] }], targetDigest: rootDigestOf(ROOT, after) };
    };
    const [x, y] = await Promise.allSettled([apply(edit(1)), apply(edit(2))]);
    const outcomes = [x, y];
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const lost = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 409 });
    expect(w.roots.get(ROOT)!.generation).toBe(2);
    const winner = x!.status === 'fulfilled' ? 1 : 2;
    expect(w.leaves.get(ROOT)!.get('f:src/f1.ts')).toBe(hashOf(900 + winner));
    expect(w.sources.get(ROOT)!.get('src/f1.ts')!.hash).toBe(hashOf(900 + winner));
  });

  it('two first packs of one root: one creates the row, the other gets 409', async () => {
    const results = await Promise.allSettled([apply(packOf(rowsFor(2))), apply(packOf(rowsFor(2)))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(w.roots.get(ROOT)!.generation).toBe(1);
  });
});

describe('legacy state', () => {
  it('removing a source also deletes its legacy per-source object, so it cannot reappear in the listing', async () => {
    const rows = rowsFor(3, 0);
    w.legacySources.set(ROOT, new Map([['src/f2.ts', { sourceId: 'src/f2.ts', path: 'src/f2.ts', hash: rows.files[2]!.hash }]]));
    await apply(packOf(rows));
    const after = { ...rows, files: rows.files.slice(0, 2) };
    await apply({ rootId: ROOT, baseGeneration: 1, deletes: { files: ['src/f2.ts'], facts: [], relations: [] }, targetDigest: rootDigestOf(ROOT, after) });
    expect(w.legacyDeleted).toEqual(['src/f2.ts']);
    expect((await fakeSync(w).sources(ROOT)).map((s) => s.path).sort()).toEqual(['src/f0.ts', 'src/f1.ts']);
  });
});

describe('bodies shared by roots', () => {
  it('a hash\'s stored body is the union by sourceRef: a second root with the same content never evicts the first', async () => {
    const shared = hashOf(1);
    const files = (root: string) => [{ path: 'src/shared.ts', hash: shared, bytes: 1 }];
    const pack = (root: string): Pack => ({
      rootId: root, baseGeneration: 0, files: files(root), extracted: [{ kind: 'full', hash: shared, entries: [extraction(root, 'src/shared.ts', shared)] }],
      targetDigest: rootDigestOf(root, { files: files(root), facts: [], relations: [] }),
    });
    await apply(pack(A));
    await apply(pack(B));
    const body = (await fakeExtracted(w).get(shared))!;
    expect(body.map((e) => e.sourceRef).sort()).toEqual([refOf(A, 'src/shared.ts'), refOf(B, 'src/shared.ts')].sort());
    expect(w.index.get(shared)!.sourceRefs.sort()).toEqual([refOf(A, 'src/shared.ts'), refOf(B, 'src/shared.ts')].sort());
    // Both roots can now skip the body for that hash.
    expect([...(await fakeSync(w).heldEntries([{ hash: shared, sourceRef: refOf(A, 'src/shared.ts') }, { hash: shared, sourceRef: refOf(B, 'src/shared.ts') }, { hash: shared, sourceRef: refOf('ws:c', 'src/shared.ts') }]))]).toEqual([0, 1]);
  });
});
