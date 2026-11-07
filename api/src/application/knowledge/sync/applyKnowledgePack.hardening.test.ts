/**
 * applyKnowledgePack hardening (PRD 41 A11 rule 4b): a body merge that lost a race is a typed 409 that writes nothing; a
 * deleted fact takes only the model relations no other root names; a migrated root's first pack reconciles its legacy
 * rows without touching what another root names; and a control character in a path or key is a 422 before any write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodePack, factLeafKey, relationLeafKey, rootDigestOf, ZERO_DIGEST, type Pack } from '@seanhogg/builderforce-memory/knowledge/pack';
import type { StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import { atomically, fakeExtracted, fakeLedger, fakeStore, fakeSync, newWorld, type World } from './syncFakes.test-util';
import { factOf, hashOf, packOf, refOf, ROOT, rowsFor, type Rows } from './packFixtures.test-util';

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
import { sourceId } from '../knowledgeBlobs';

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

describe('body_conflict', () => {
  it('a concurrent index move between the basis read and the locked re-check is 409 body_conflict, and nothing is written', async () => {
    const rows = rowsFor(1, 0);
    const hash = rows.files[0]!.hash;
    const sync = fakeSync(w);
    // The bundle is put after the basis was read and before the lock: another pack indexes the same hash in that window.
    const racing: ApplyDeps['sync'] = {
      ...sync,
      putBundle: async (bundle) => {
        await sync.putBundle(bundle);
        w.index.set(hash, { hash, bundleKey: 'other-pack-bundle', byteOffset: 0, byteLength: 2, sourceRefs: [] });
      },
    };
    await expect(apply(packOf(rows), { sync: racing })).rejects.toMatchObject({ status: 409, code: 'body_conflict', detail: { hashes: [hash] } });
    expect(w.roots.size).toBe(0);
    expect(w.sources.get(ROOT)?.size ?? 0).toBe(0);
    expect(w.leaves.get(ROOT)?.size ?? 0).toBe(0);
    expect(w.facts.size).toBe(0);
    expect(w.relations.size).toBe(0);
    expect(w.index.get(hash)?.bundleKey).toBe('other-pack-bundle'); // the other pack's row is untouched
    expect(w.index.size).toBe(1);
  });
});

describe('deleting a fact cascades only to model relations no other root names (M2)', () => {
  it('keeps the relation root B also names (skipped: other_root) and deletes the one only A names', async () => {
    const shared = rel('fact:x', 'fact:y', 'related');
    const solo = rel('fact:x', 'fact:z', 'cites');
    const rowsA: Rows = { files: [{ path: 'src/a.ts', hash: hashOf(1), bytes: 1 }], facts: [factOf('x', 'src/a.ts')], relations: [shared, solo] };
    const rowsB: Rows = { files: [{ path: 'src/b.ts', hash: hashOf(2), bytes: 1 }], facts: [factOf('y', 'src/b.ts')], relations: [shared] };
    await apply(packOf(rowsA, { root: A }));
    await apply(packOf(rowsB, { root: B }));
    expect(w.relations.size).toBe(2);

    const del: Pack = { rootId: A, baseGeneration: 1, deletes: { files: [], facts: ['x'], relations: [] }, targetDigest: ZERO_DIGEST };
    const res = await apply(del);
    expect(res).toMatchObject({ applied: true });
    if (!res.applied) throw new Error('unreachable');
    expect(w.facts.has('x')).toBe(false);
    expect(w.relations.has(relationLeafKey(shared))).toBe(true);
    expect(w.relations.has(relationLeafKey(solo))).toBe(false);
    expect(res.skipped).toEqual([{ key: relationLeafKey(shared), reason: 'other_root' }]);
    expect(w.facts.has('y')).toBe(true);
  });
});

describe('a migrated root\'s first pack (a generation row, no leaves)', () => {
  it('marks unnamed legacy sources removed, deletes their sole-anchored model facts, and spares rows another root names', async () => {
    const keep = { path: 'src/keep.ts', hash: hashOf(7), bytes: 1 };
    const old1 = { path: 'src/old1.ts', hash: hashOf(8) };
    const old2 = { path: 'src/old2.ts', hash: hashOf(9) };
    w.roots.set(ROOT, { generation: 1, digest: 'legacy' });
    w.legacySources.set(ROOT, new Map([keep, old1, old2].map((s) => [sourceId(s.path, s.hash), { sourceId: sourceId(s.path, s.hash), path: s.path, hash: s.hash }])));
    const modelFact = (key: string, paths: string[]): StoredFact & { createdBy: null } =>
      ({ key, content: key, source: 'review', importance: 0.5, origin: 'model', fileAnchors: paths.map((path) => ({ path, contentHash: 'c' })), createdBy: null });
    w.facts.set('old:sole', modelFact('old:sole', [old1.path]));
    w.facts.set('old:mixed', modelFact('old:mixed', [old1.path, keep.path]));
    w.facts.set('old:shared', modelFact('old:shared', [old2.path]));
    const soleRel = rel(refOf(ROOT, old1.path), 'fact:old:sole', 'about');
    const sharedRel = rel(refOf(ROOT, old2.path), 'fact:old:shared', 'about');
    w.relations.set(relationLeafKey(soleRel), soleRel);
    w.relations.set(relationLeafKey(sharedRel), sharedRel);
    // Root B names the shared fact and its relation.
    w.leaves.set(B, new Map([[factLeafKey('old:shared'), 'd'], [relationLeafKey(sharedRel), 'd']]));

    const rows: Rows = { files: [keep], facts: [], relations: [] };
    const res = await apply({ ...packOf(rows, { generation: 1 }), targetDigest: rootDigestOf(ROOT, rows) });
    expect(res).toMatchObject({ applied: true, generation: 2 });
    if (!res.applied) throw new Error('unreachable');

    // The unnamed legacy sources are removed (marker rows) and their legacy objects deleted; the named one stays.
    expect(w.sources.get(ROOT)!.get(sourceId(old1.path, old1.hash))?.hash).toBe('');
    expect(w.sources.get(ROOT)!.get(sourceId(old2.path, old2.hash))?.hash).toBe('');
    expect(w.legacyDeleted.sort()).toEqual([sourceId(old1.path, old1.hash), sourceId(old2.path, old2.hash)].sort());
    expect(w.sources.get(ROOT)!.get(sourceId(keep.path, keep.hash))?.hash).not.toBe(''); // the source the pack names is not marked removed

    // Sole-anchored model fact and its relation go; a fact still anchored to a kept source, and rows B names, stay.
    expect(w.facts.has('old:sole')).toBe(false);
    expect(w.relations.has(relationLeafKey(soleRel))).toBe(false);
    expect(w.facts.has('old:mixed')).toBe(true);
    expect(w.facts.has('old:shared')).toBe(true);
    expect(w.relations.has(relationLeafKey(sharedRel))).toBe(true);
    expect(res.skipped).toEqual(expect.arrayContaining([
      { key: factLeafKey('old:shared'), reason: 'other_root' }, { key: relationLeafKey(sharedRel), reason: 'other_root' },
    ]));
    expect(res.skipped).toHaveLength(2);
  });
});

describe('control characters', () => {
  it('a path with \\u0001 is 422 bad_pack, and nothing is written', async () => {
    const rows = rowsFor(2, 0);
    const bad: Rows = { ...rows, files: [{ path: 'src/a\u0001b.ts', hash: hashOf(1), bytes: 1 }, rows.files[1]!] };
    await expect(apply(packOf(bad))).rejects.toMatchObject({ status: 422, code: 'bad_pack' });
    expect(w.puts).toEqual([]);
    expect(w.roots.size).toBe(0);
  });

  it('a fact key or a DEL in a path is refused the same way', async () => {
    const rows = rowsFor(2, 0);
    await expect(apply(packOf({ ...rows, facts: [factOf('claim:\u0001', rows.files[0]!.path)] }))).rejects.toMatchObject({ status: 422, code: 'bad_pack' });
    await expect(apply(packOf({ ...rows, files: [{ path: 'src/\u007f.ts', hash: hashOf(1), bytes: 1 }] }))).rejects.toMatchObject({ status: 422, code: 'bad_pack' });
    expect(w.puts).toEqual([]);
  });
});
