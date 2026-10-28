/**
 * The knowledge use cases (PRD 38 WS2): the cached graph (a hit, then a miss after a
 * write), the single writer's bounds, and the fact delete's author/admin rule.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Extracted, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(async () => true),
  deleteFact: vi.fn(async () => true),
  bump: vi.fn(async () => undefined),
  superadmin: vi.fn(async () => false),
}));
vi.mock('../llm/projectFactsWrite', () => ({ upsertProjectFact: mocks.upsert, deleteProjectFact: mocks.deleteFact }));
vi.mock('./knowledgeVersion', () => ({ bumpKnowledgeVersion: mocks.bump, knowledgeVersion: vi.fn() }));
vi.mock('../../infrastructure/auth/superadminFlag', () => ({ resolveIsSuperadmin: mocks.superadmin }));

import { clampMaxNodes, getKnowledgeGraph, knowledgeGraphCacheKey, type KnowledgeGraphDeps } from './getKnowledgeGraph';
import { KnowledgeWriteError, MAX_KNOWLEDGE_WRITE_ROWS, writeKnowledge } from './writeKnowledge';
import { deleteKnowledgeFact, factViewer } from './deleteKnowledgeFact';
import { listKnowledgeFacts, listKnowledgeScopes } from './listKnowledge';
import type { ExtractedCachePort, KnowledgeStorePort } from './knowledgePorts';

const ROOT = 'web:folder-1:';
const extractedA: Extracted = {
  sourceRef: `src:${ROOT}::docs/a.md`, sourceHash: 'h1',
  nodes: [{ ref: `src:${ROOT}::docs/a.md`, kind: 'file', label: 'a.md', pack: 'docs', importance: 0, origin: 'extracted', sourceHash: 'h1' }],
  edges: [], keys: [],
};

/** The same root as the review before: one file, which the last review renamed to a.md. */
const extractedOld: Extracted = {
  sourceRef: `src:${ROOT}::docs/old.md`, sourceHash: 'h0',
  nodes: [{ ref: `src:${ROOT}::docs/old.md`, kind: 'file', label: 'old.md', pack: 'docs', importance: 0, origin: 'extracted', sourceHash: 'h0' }],
  edges: [], keys: [],
};

function fakeStore(over: Partial<KnowledgeStorePort> = {}): KnowledgeStorePort {
  return {
    scopes: vi.fn(async () => []),
    scope: vi.fn(async () => ({ rootId: ROOT, title: 'Folder', packs: ['docs'], lastDigest: 'd1' })),
    facts: vi.fn(async () => []),
    relations: vi.fn(async () => []),
    upsertRelations: vi.fn(async (rows: readonly StoredRelation[]) => rows.length),
    upsertScope: vi.fn(async () => undefined),
    markRelationsStale: vi.fn(async () => 2),
    deleteRelationsOf: vi.fn(async () => 3),
    factAuthor: vi.fn(async () => null),
    ...over,
  };
}

function fakeBlobs(): ExtractedCachePort {
  return {
    get: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
    setSource: vi.fn(async () => undefined),
    rootExtracted: vi.fn(async () => [extractedA]),
    snapshotReview: vi.fn(async () => undefined),
    reviewExtracted: vi.fn(async (_root: string, digest: string) => (digest === 'd0' ? [extractedOld] : null)),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('getKnowledgeGraph', () => {
  let version = 'v1';
  const deps = (): KnowledgeGraphDeps & { extracted: ExtractedCachePort } => ({
    cacheEnv: undefined, tenantId: 4, projectId: 9,
    store: fakeStore(), extracted: fakeBlobs(),
    analysis: { put: vi.fn(), latest: vi.fn(async () => null) },
    repo: { linked: async () => null },
    version: async () => version,
  });

  it('serves the second call from cache, and misses after a write bumps the version', async () => {
    version = 'v1';
    const d = deps();
    const first = await getKnowledgeGraph(d, { rootId: ROOT });
    expect(first?.nodes.map((n) => n.ref)).toContain(`src:${ROOT}::docs/a.md`);
    await getKnowledgeGraph(d, { rootId: ROOT });
    expect(d.extracted.rootExtracted).toHaveBeenCalledTimes(1);

    version = 'v2'; // what writeKnowledge's bump does to the token
    await getKnowledgeGraph(d, { rootId: ROOT });
    expect(d.extracted.rootExtracted).toHaveBeenCalledTimes(2);
  });

  it('is null for a root that was never reviewed and is not the linked repo', async () => {
    const d = { ...deps(), store: fakeStore({ scope: vi.fn(async () => null) }) };
    expect(await getKnowledgeGraph(d, { rootId: 'nope' })).toBeNull();
  });

  it('builds the baseline at a previous digest from that review, which differs from the current graph', async () => {
    version = 'v-at-1';
    const d = deps();
    const current = await getKnowledgeGraph(d, { rootId: ROOT });
    const before = await getKnowledgeGraph(d, { rootId: ROOT, at: 'd0' });
    expect(d.extracted.reviewExtracted).toHaveBeenCalledWith(ROOT, 'd0');
    expect(before?.nodes.map((n) => n.ref)).toEqual([`src:${ROOT}::docs/old.md`]);
    expect(current?.nodes.map((n) => n.ref)).not.toContain(`src:${ROOT}::docs/old.md`);
    expect(before?.scope.digest).not.toBe(current?.scope.digest);
    // The baseline joins the CURRENT memory: facts and relations are read for it too.
    expect(d.store.facts).toHaveBeenCalledTimes(2);
    expect(d.store.relations).toHaveBeenCalledTimes(2);
  });

  it('keys the cache on `at`: each digest builds once, and differs from the current graph', async () => {
    version = 'v-at-2';
    const d = deps();
    await getKnowledgeGraph(d, { rootId: ROOT, at: 'd0' });
    await getKnowledgeGraph(d, { rootId: ROOT, at: 'd0' });
    expect(d.extracted.reviewExtracted).toHaveBeenCalledTimes(1);
    await getKnowledgeGraph(d, { rootId: ROOT, at: 'd9' });
    expect(d.extracted.reviewExtracted).toHaveBeenCalledTimes(2);
    await getKnowledgeGraph(d, { rootId: ROOT });
    expect(d.extracted.rootExtracted).toHaveBeenCalledTimes(1);
    expect(knowledgeGraphCacheKey({ tenantId: 4, projectId: 9, rootId: ROOT, scopeDigest: '@d0', version: 'v', focusHash: '-', maxNodes: 400 }))
      .toContain(':@d0:');
  });

  it('is null at a digest that has no review snapshot', async () => {
    version = 'v-at-3';
    expect(await getKnowledgeGraph(deps(), { rootId: ROOT, at: 'd9' })).toBeNull();
  });

  it('caps maxNodes at 2000', () => {
    expect(clampMaxNodes(99_999)).toBe(2000);
    expect(clampMaxNodes(undefined)).toBe(400);
    expect(clampMaxNodes(0)).toBe(1);
  });
});

describe('writeKnowledge', () => {
  const base = () => ({ env: {} as never, db: {} as never, tenantId: 4, projectId: 9, store: fakeStore(), blobs: fakeBlobs(), userId: 'u1' });
  const rel = (i: number): StoredRelation => ({ from: `fact:claim:${i}`, to: `src:${ROOT}::docs/a.md`, kind: 'about', weight: 1, origin: 'model' });

  it(`refuses more than ${MAX_KNOWLEDGE_WRITE_ROWS} rows with 413, writing nothing`, async () => {
    const d = base();
    const err = await writeKnowledge(d, { relations: Array.from({ length: MAX_KNOWLEDGE_WRITE_ROWS + 1 }, (_, i) => rel(i)) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KnowledgeWriteError);
    expect(err).toMatchObject({ status: 413 });
    expect(d.store.upsertRelations).not.toHaveBeenCalled();
    expect(mocks.bump).not.toHaveBeenCalled();
  });

  it('writes no review snapshot for a scope write without a digest', async () => {
    const d = base();
    await writeKnowledge(d, { scope: { rootId: ROOT, title: 'F', packs: ['docs'] } });
    expect(d.blobs.snapshotReview).not.toHaveBeenCalled();
    expect(d.store.upsertScope).toHaveBeenCalledTimes(1);
  });

  it("refuses origin 'extracted' with 400", async () => {
    const d = base();
    const bad = { ...rel(1), origin: 'extracted' } as unknown as StoredRelation;
    await expect(writeKnowledge(d, { relations: [bad] })).rejects.toMatchObject({ status: 400, code: 'extracted_not_stored' });
    expect(d.store.upsertRelations).not.toHaveBeenCalled();
  });

  it('writes facts through the one upsert (no anchor sweep, one bump), relations, stale marks and the scope', async () => {
    const d = base();
    const out = await writeKnowledge(d, {
      scope: { rootId: ROOT, title: 'F', packs: ['docs'], lastDigest: 'd2' },
      facts: [{ key: 'claim:x', content: 'a says b', source: 'knowledge-review', origin: 'model', fileAnchors: [{ path: 'docs/a.md', contentHash: 'h1' }] }],
      relations: [rel(1)],
      stale: [{ sourceRef: `src:${ROOT}::docs/a.md`, currentHash: 'h2' }],
    });
    expect(out).toEqual({ factsWritten: 1, relationsWritten: 1, staleMarked: 2 });
    expect((mocks.upsert.mock.calls[0] as unknown[])[7]).toMatchObject({ retireByAnchor: false, deferVersionBump: true, factOrigin: 'model', createdBy: null });
    expect(d.blobs.setSource).toHaveBeenCalledWith(`src:${ROOT}::docs/a.md`, 'h2');
    expect(d.store.upsertScope).toHaveBeenCalledTimes(1);
    // The digest's review snapshot is written before the scope records the digest.
    expect(d.blobs.snapshotReview).toHaveBeenCalledWith(ROOT, 'd2');
    expect((d.blobs.snapshotReview as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
      .toBeLessThan((d.store.upsertScope as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!);
    expect(mocks.bump).toHaveBeenCalledTimes(1);
  });
});

describe('deleteKnowledgeFact', () => {
  const run = (store: KnowledgeStorePort, actor: { userId: string | null; role: string | null }) =>
    deleteKnowledgeFact({ env: {} as never, db: {} as never, tenantId: 4, projectId: 9, store }, actor, 'claim:x');

  it('refuses a non-author non-admin, touching nothing', async () => {
    const store = fakeStore({ factAuthor: vi.fn(async () => 'u2') });
    const out = await run(store, { userId: 'u1', role: 'developer' });
    expect(out).toMatchObject({ ok: false, status: 403 });
    expect(store.deleteRelationsOf).not.toHaveBeenCalled();
    expect(mocks.deleteFact).not.toHaveBeenCalled();
  });

  it('lets the author delete, removing the fact’s relations too', async () => {
    const store = fakeStore({ factAuthor: vi.fn(async () => 'u1') });
    const out = await run(store, { userId: 'u1', role: 'developer' });
    expect(out).toEqual({ ok: true, removed: true, relationsRemoved: 3 });
    expect(store.deleteRelationsOf).toHaveBeenCalledWith('fact:claim:x');
  });

  it('lets a project admin delete another person’s fact', async () => {
    const store = fakeStore({ factAuthor: vi.fn(async () => 'u2') });
    expect(await run(store, { userId: 'u1', role: 'manager' })).toMatchObject({ ok: true });
  });

  it('bumps the version when only relations were removed', async () => {
    mocks.deleteFact.mockResolvedValueOnce(false);
    const store = fakeStore({ factAuthor: vi.fn(async () => undefined) });
    await run(store, { userId: null, role: null });
    expect(mocks.bump).toHaveBeenCalledTimes(1);
  });
});

describe('listKnowledge', () => {
  let version = 'lv1';
  const deps = (store = fakeStore()): KnowledgeGraphDeps & { extracted: ExtractedCachePort } => ({
    cacheEnv: undefined, tenantId: 5, projectId: 11,
    store, extracted: fakeBlobs(),
    analysis: { put: vi.fn(), latest: vi.fn(async () => null) },
    repo: { linked: async () => null },
    version: async () => version,
  });
  const authored = { key: 'claim:a', content: 'a', source: 'knowledge', importance: 0.5, origin: 'human' as const, fileAnchors: [{ path: 'docs/a.md' }], createdBy: 'u1' };

  it('reads a root’s facts in one store query over its sources, cached until the version moves', async () => {
    version = 'lv1';
    const d = deps(fakeStore({ facts: vi.fn(async () => [authored]) }));
    expect(await listKnowledgeFacts(d, ROOT)).toEqual([authored]);
    expect(d.store.facts).toHaveBeenCalledWith(new Set(['docs/a.md']));
    await listKnowledgeFacts(d, ROOT);
    expect(d.store.facts).toHaveBeenCalledTimes(1);
    version = 'lv2';
    await listKnowledgeFacts(d, ROOT);
    expect(d.store.facts).toHaveBeenCalledTimes(2);
  });

  it('is null for an unknown root', async () => {
    expect(await listKnowledgeFacts(deps(fakeStore({ scope: vi.fn(async () => null) })), 'nope')).toBeNull();
  });

  it('caches the scopes on the knowledge version', async () => {
    version = 'lv-s1';
    const d = deps();
    await listKnowledgeScopes(d);
    await listKnowledgeScopes(d);
    expect(d.store.scopes).toHaveBeenCalledTimes(1);
    version = 'lv-s2'; // a scope write bumps it
    await listKnowledgeScopes(d);
    expect(d.store.scopes).toHaveBeenCalledTimes(2);
  });
});

describe('factViewer', () => {
  it('is the delete rule: a manager administers, a developer does not, a machine never asks for superadmin', async () => {
    expect(await factViewer({} as never, { userId: 'u1', role: 'manager' })).toEqual({ userId: 'u1', canAdmin: true });
    expect(await factViewer({} as never, { userId: 'u1', role: 'developer' })).toEqual({ userId: 'u1', canAdmin: false });
    expect(await factViewer({} as never, { userId: null, role: 'developer' })).toEqual({ userId: null, canAdmin: false });
    expect(mocks.superadmin).toHaveBeenCalledTimes(1);
  });
});

describe('writeKnowledge provenance', () => {
  const d = (userId: string | null) => ({ env: {} as never, db: {} as never, tenantId: 4, projectId: 9, store: fakeStore(), blobs: fakeBlobs(), userId });
  const f = (origin?: 'human' | 'agent' | 'model') => ({ key: 'k', content: 'c', source: 'knowledge', fileAnchors: [], ...(origin ? { origin } : {}) });

  it('derives the origin from the writer when absent', async () => {
    await writeKnowledge(d('u1'), { facts: [f()] });
    await writeKnowledge(d(null), { facts: [f()] });
    expect((mocks.upsert.mock.calls[0] as unknown[])[7]).toMatchObject({ factOrigin: 'human', createdBy: 'u1' });
    expect((mocks.upsert.mock.calls[1] as unknown[])[7]).toMatchObject({ factOrigin: 'agent', createdBy: null });
  });

  it("refuses 'human' from a machine and 'agent' from a person, writing nothing", async () => {
    await expect(writeKnowledge(d(null), { facts: [f('human')] })).rejects.toMatchObject({ status: 400, code: 'origin_mismatch' });
    await expect(writeKnowledge(d('u1'), { facts: [f('agent')] })).rejects.toMatchObject({ status: 400, code: 'origin_mismatch' });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.bump).not.toHaveBeenCalled();
  });

  it("admits 'model' from either writer, never authored", async () => {
    await writeKnowledge(d('u1'), { facts: [f('model')] });
    await writeKnowledge(d(null), { facts: [f('model')] });
    for (const call of mocks.upsert.mock.calls) expect((call as unknown[])[7]).toMatchObject({ factOrigin: 'model', createdBy: null });
  });
});
