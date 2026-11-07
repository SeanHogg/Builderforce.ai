/**
 * writeKnowledge for an uploaded PACK root (PRD 40, OD-2): the server stamps the pack's root
 * id as every fact's `source`, never overwrites a fact the pack does not own, fences the
 * pack's relations to its own rows (and never over a person's edge), records the uploader and
 * keeps provenance for pack roots only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upsert: vi.fn(async () => true), bump: vi.fn(async () => undefined), superadmin: vi.fn(async () => false) }));
vi.mock('../llm/projectFactsWrite', async () => ({ upsertProjectFact: mocks.upsert, upsertProjectFacts: (await import('./factWriterMock.test-util')).batchOverSingle(mocks.upsert as never), deleteProjectFact: vi.fn() }));
vi.mock('./knowledgeVersion', () => ({ bumpKnowledgeVersion: mocks.bump, knowledgeVersion: vi.fn() }));
vi.mock('../../infrastructure/auth/superadminFlag', () => ({ resolveIsSuperadmin: mocks.superadmin }));

import { writeKnowledge } from './writeKnowledge';
import { KnowledgeWriteError } from './knowledgeWriteError';
import type { ExtractedCachePort, KnowledgeScope, KnowledgeStorePort } from './knowledgePorts';

const PACK = 'pack:docs-1a2b3c4d';

function store(owners: Record<string, string>, opts: { scope?: KnowledgeScope | null; human?: string[] } = {}): KnowledgeStorePort {
  return {
    factSources: vi.fn(async (keys: readonly string[]) => new Map(keys.filter((k) => k in owners).map((k) => [k, owners[k]!] as const))),
    factAuthor: vi.fn(async () => undefined),
    scope: vi.fn(async () => opts.scope ?? null),
    humanRelationKeys: vi.fn(async () => new Set(opts.human ?? [])),
    upsertRelations: vi.fn(async (rows: readonly unknown[]) => rows.length),
    upsertScope: vi.fn(async () => undefined),
    markRelationsStale: vi.fn(async () => 0),
  } as unknown as KnowledgeStorePort;
}
const blobs = { setSource: vi.fn(), snapshotReview: vi.fn() } as unknown as ExtractedCachePort;
const deps = (s: KnowledgeStorePort, over: { userId?: string | null; actorRole?: string | null } = {}) => ({
  env: {} as never, db: {} as never, tenantId: 4, projectId: 9, store: s, blobs, userId: 'u1', actorRole: 'developer', ...over,
});
const fact = (key: string, source = 'whatever-the-client-sent') => ({ key, content: 'c', source, fileAnchors: [] });
const sourceOfCall = (i: number) => (mocks.upsert.mock.calls[i] as unknown[])[6];
const rel = (from: string, to: string) => ({ from, to, kind: 'about', weight: 1, origin: 'model', sourceHash: 'h' }) as never;
const writtenRelations = (s: KnowledgeStorePort) => (s.upsertRelations as unknown as { mock: { calls: Array<[Array<{ from: string; to: string }>]> } }).mock.calls[0]![0];

beforeEach(() => { vi.clearAllMocks(); mocks.superadmin.mockResolvedValue(false); });

describe('writing a pack root', () => {
  it('forces every fact’s source to the pack root, whatever the client sent — on a chunk with no scope', async () => {
    await writeKnowledge(deps(store({})), { root: PACK, facts: [fact('a'), fact('b', 'agent')] });
    expect([sourceOfCall(0), sourceOfCall(1)]).toEqual([PACK, PACK]);
  });

  it('also stamps the root when it is known only from the scope', async () => {
    await writeKnowledge(deps(store({})), { scope: { rootId: PACK, title: 'Docs', packs: [] }, facts: [fact('a')] });
    expect(sourceOfCall(0)).toBe(PACK);
  });

  it('skips a key a person or another source already owns, rewrites its own, and reports the skip', async () => {
    const out = await writeKnowledge(deps(store({ human: 'knowledge', mine: PACK })), { root: PACK, facts: [fact('human'), fact('mine'), fact('fresh')] });
    expect(out).toMatchObject({ factsWritten: 2, factsSkipped: ['human'] });
    expect(mocks.upsert.mock.calls.map((c) => (c as unknown[])[4])).toEqual(['mine', 'fresh']);
  });

  it('refuses a scope that names another root than the write', async () => {
    await expect(writeKnowledge(deps(store({})), { root: PACK, scope: { rootId: 'web:folder-1', title: 'x', packs: [] }, facts: [] }))
      .rejects.toBeInstanceOf(KnowledgeWriteError);
  });

  it('reserves a `pack:` source for pack writes', async () => {
    await expect(writeKnowledge(deps(store({})), { root: 'web:folder-1', facts: [fact('a', PACK)] }))
      .rejects.toMatchObject({ code: 'reserved_source' });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('leaves a reviewed root’s sources as the client sent them', async () => {
    await writeKnowledge(deps(store({})), { root: 'web:folder-1', facts: [fact('a', 'knowledge-review')] });
    expect(sourceOfCall(0)).toBe('knowledge-review');
  });
});

describe('a pack’s relations are fenced to its own rows', () => {
  it('keeps an edge with a pack source or pack fact end, refuses an edge between two foreign facts', async () => {
    const s = store({ mine: PACK, stranger: 'knowledge' });
    const out = await writeKnowledge(deps(s), {
      root: PACK,
      facts: [fact('fresh')],
      relations: [
        rel('fact:fresh', `src:${PACK}::a.md`),   // pack fact → pack source
        rel('fact:mine', 'fact:stranger'),        // owned (stored earlier) → foreign
        rel('fact:stranger', 'fact:other'),       // foreign ↔ foreign: refused
      ],
    });
    expect(writtenRelations(s).map((r) => `${r.from}>${r.to}`)).toEqual([`fact:fresh>src:${PACK}::a.md`, 'fact:mine>fact:stranger']);
    expect(out.relationsSkipped).toEqual(['fact:stranger -> fact:other (about)']);
  });

  it('never overwrites a person’s edge: a human A→B survives, the pack’s own edges still land', async () => {
    const human = `fact:mine\u0000fact:stranger\u0000about`;
    const s = store({ mine: PACK, stranger: 'knowledge' }, { human: [human] });
    const out = await writeKnowledge(deps(s), { root: PACK, facts: [], relations: [rel('fact:mine', 'fact:stranger'), rel('fact:mine', `src:${PACK}::a.md`)] });
    expect(writtenRelations(s).map((r) => r.to)).toEqual([`src:${PACK}::a.md`]);
    expect(out.relationsSkipped).toEqual(['fact:mine -> fact:stranger (about)']);
  });

  it('drops stale marks whose source is not under the pack’s root', async () => {
    const out = await writeKnowledge(deps(store({})), {
      root: PACK, facts: [],
      stale: [{ sourceRef: `src:${PACK}::a.md` as never, currentHash: 'h' }, { sourceRef: 'src:web:folder-1::a.md' as never, currentHash: 'h' }],
    });
    expect(out).toMatchObject({ staleMarked: 0, staleSkipped: 1 });
    expect(vi.mocked(blobs.setSource)).toHaveBeenCalledTimes(1);
  });
});

describe('who may write a pack', () => {
  it('refuses a machine caller and a viewer', async () => {
    await expect(writeKnowledge(deps(store({}), { userId: null }), { root: PACK, facts: [] })).rejects.toMatchObject({ status: 403 });
    await expect(writeKnowledge(deps(store({}), { actorRole: 'viewer' }), { root: PACK, facts: [] })).rejects.toMatchObject({ status: 403 });
  });

  it('refuses another developer over an existing pack, allows the uploader, a manager and a superadmin', async () => {
    const existing: KnowledgeScope = { rootId: PACK, title: 'x', packs: [], provenance: { uploadedBy: 'someone-else' } };
    await expect(writeKnowledge(deps(store({}, { scope: existing })), { root: PACK, facts: [] })).rejects.toMatchObject({ status: 403 });
    await expect(writeKnowledge(deps(store({}, { scope: existing }), { actorRole: 'manager' }), { root: PACK, facts: [] })).resolves.toBeTruthy();
    mocks.superadmin.mockResolvedValue(true);
    await expect(writeKnowledge(deps(store({}, { scope: existing })), { root: PACK, facts: [] })).resolves.toBeTruthy();
    mocks.superadmin.mockResolvedValue(false);
    await expect(writeKnowledge(deps(store({}, { scope: { ...existing, provenance: { uploadedBy: 'u1' } } })), { root: PACK, facts: [] })).resolves.toBeTruthy();
  });
});

describe('a pack’s scope and provenance', () => {
  const provenance = { reviewedBy: 'Ada', judgeModel: 'claude-x', reviewedAt: '2026-11-01T00:00:00Z' };

  it('stores provenance and records the uploader server-side, overriding any client value', async () => {
    const s = store({});
    await writeKnowledge(deps(s), { root: PACK, scope: { rootId: PACK, title: 'Docs', packs: [], provenance: { ...provenance, uploadedBy: 'forged' } as never }, facts: [] });
    expect(s.upsertScope).toHaveBeenCalledWith(expect.objectContaining({ rootId: PACK, provenance: { ...provenance, uploadedBy: 'u1' } }));
  });

  it('records a stub scope when a chunk names the root but carries no scope, never replacing an existing one', async () => {
    const fresh = store({});
    await writeKnowledge(deps(fresh), { root: PACK, facts: [fact('a')] });
    expect(fresh.upsertScope).toHaveBeenCalledWith(expect.objectContaining({ rootId: PACK, provenance: { uploadedBy: 'u1' } }));

    const existing = store({}, { scope: { rootId: PACK, title: 'x', packs: [], provenance: { uploadedBy: 'u1' } } });
    await writeKnowledge(deps(existing), { root: PACK, facts: [fact('a')] });
    expect(existing.upsertScope).not.toHaveBeenCalled();
  });

  it('ignores provenance on a reviewed root’s scope', async () => {
    const s = store({});
    await writeKnowledge(deps(s), { root: 'web:folder-1', scope: { rootId: 'web:folder-1', title: 'F', packs: [], provenance }, facts: [] });
    const written = (s.upsertScope as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls[0]![0];
    expect(written).not.toHaveProperty('provenance');
  });
});
