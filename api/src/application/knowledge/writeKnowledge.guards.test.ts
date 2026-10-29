/**
 * writeKnowledge's guards on WHO may overwrite WHAT (PRD 38 §4.2, §5.2, §8.3):
 *   • a machine never replaces a fact a person authored — it is skipped and reported, the
 *     rest of the batch lands — except a `codemap:` key, which it merges into as a guest
 *     (the fact keeps its origin and author);
 *   • a model relation on a source must name the hash it was judged from.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredRelation } from '@seanhogg/builderforce-memory/knowledge';

const mocks = vi.hoisted(() => ({ upsert: vi.fn(async () => true), bump: vi.fn(async () => undefined) }));
vi.mock('../llm/projectFactsWrite', () => ({ upsertProjectFact: mocks.upsert, deleteProjectFact: vi.fn() }));
vi.mock('./knowledgeVersion', () => ({ bumpKnowledgeVersion: mocks.bump, knowledgeVersion: vi.fn() }));

import { writeKnowledge } from './writeKnowledge';
import type { ExtractedCachePort, KnowledgeStorePort } from './knowledgePorts';

function store(authors: Record<string, string | null>): KnowledgeStorePort {
  return {
    scopes: vi.fn(async () => []), scope: vi.fn(async () => null), facts: vi.fn(async () => []), relations: vi.fn(async () => []),
    upsertRelations: vi.fn(async (rows: readonly StoredRelation[]) => rows.length),
    upsertScope: vi.fn(async () => undefined), markRelationsStale: vi.fn(async () => 0), deleteRelationsOf: vi.fn(async () => 0),
    // `undefined` = no such fact; null = no recorded author; string = the person who wrote it.
    factAuthor: vi.fn(async (key: string) => (key in authors ? authors[key] : undefined)),
  };
}
const blobs = { setSource: vi.fn(), snapshotReview: vi.fn() } as unknown as ExtractedCachePort;
const deps = (s: KnowledgeStorePort, userId: string | null) => ({ env: {} as never, db: {} as never, tenantId: 4, projectId: 9, store: s, blobs, userId });
const fact = (key: string, content = 'c') => ({ key, content, source: 'cloud-run', fileAnchors: [] });
const opts = (call: number) => (mocks.upsert.mock.calls[call] as unknown[])[7] as Record<string, unknown>;

beforeEach(() => vi.clearAllMocks());

describe('a machine writing over a person’s fact', () => {
  it('skips the person-authored key, reports it, and still writes the rest of the batch', async () => {
    const s = store({ mine: 'u1', theirs: null });
    const out = await writeKnowledge(deps(s, null), { facts: [fact('mine'), fact('theirs'), fact('fresh')] });
    expect(out).toMatchObject({ factsWritten: 2, factsSkipped: ['mine'] });
    expect(mocks.upsert.mock.calls.map((c) => (c as unknown[])[4])).toEqual(['theirs', 'fresh']);
    expect(mocks.bump).toHaveBeenCalledTimes(1);
  });

  it('reports nothing skipped when nothing was', async () => {
    const out = await writeKnowledge(deps(store({}), null), { facts: [fact('fresh')] });
    expect(out).toEqual({ factsWritten: 1, relationsWritten: 0, staleMarked: 0 });
  });

  it('lets a code map merge into a person’s fact as a guest: no origin change, no author', async () => {
    const s = store({ 'codemap:src/billing': 'u1' });
    const out = await writeKnowledge(deps(s, null), { facts: [fact('codemap:src/billing', '- src/billing/a.ts: charges')] });
    expect(out.factsWritten).toBe(1);
    expect(out.factsSkipped).toBeUndefined();
    const o = opts(0);
    expect(o).not.toHaveProperty('factOrigin');
    expect(o).toMatchObject({ createdBy: null });
  });

  it('stamps a code map nobody authored as agent, as before', async () => {
    await writeKnowledge(deps(store({ 'codemap:src/billing': null }), null), { facts: [fact('codemap:src/billing')] });
    expect(opts(0)).toMatchObject({ factOrigin: 'agent', createdBy: null });
  });

  it('never consults authorship for a person’s own write', async () => {
    const s = store({ k: 'u2' });
    const out = await writeKnowledge(deps(s, 'u1'), { facts: [fact('k')] });
    expect(out.factsWritten).toBe(1);
    expect(s.factAuthor).not.toHaveBeenCalled();
    expect(opts(0)).toMatchObject({ factOrigin: 'human', createdBy: 'u1' });
  });
});

describe('a model relation on a source', () => {
  const rel = (over: Partial<StoredRelation>): StoredRelation => ({ from: 'fact:claim:1', to: 'src:r::a.md', kind: 'about', weight: 1, origin: 'model', ...over });

  it('must name the sourceHash it was judged from (400 missing_source_hash), writing nothing', async () => {
    const s = store({});
    for (const bad of [rel({}), rel({ from: 'src:r::a.md', to: 'fact:claim:1' })]) {
      await expect(writeKnowledge(deps(s, 'u1'), { facts: [fact('claim:1')], relations: [bad] }))
        .rejects.toMatchObject({ status: 400, code: 'missing_source_hash' });
    }
    expect(s.upsertRelations).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.bump).not.toHaveBeenCalled();
  });

  it('is accepted with its hash, and without one when it touches no source or is not a model edge', async () => {
    const s = store({});
    const out = await writeKnowledge(deps(s, 'u1'), {
      relations: [
        rel({ sourceHash: 'h1' }),
        rel({ to: 'fact:claim:2' }),
        rel({ origin: 'human' }),
      ],
    });
    expect(out.relationsWritten).toBe(3);
  });
});
