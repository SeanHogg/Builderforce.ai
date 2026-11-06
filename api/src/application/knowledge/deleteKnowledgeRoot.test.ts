/**
 * deleteKnowledgeRoot deletes by PROVENANCE: only a pack root is removable; the rows whose
 * `source` is the pack go (however many), same-path facts of other sources stay, source
 * objects go by key prefix, a stranded upload (no scope row) is still cleared, and the
 * knowledge version moves exactly once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ bump: vi.fn(async () => undefined) }));
vi.mock('./knowledgeVersion', () => ({ bumpKnowledgeVersion: mocks.bump, knowledgeVersion: vi.fn() }));

import { deleteKnowledgeRoot } from './deleteKnowledgeRoot';
import type { KnowledgeGraphDeps } from './getKnowledgeGraph';

const PACK = 'pack:docs-1a2b3c4d';

interface Row { key: string; source: string; path: string }

function setup(rows: Row[], opts: { scopeExists?: boolean; sources?: number } = {}) {
  const facts = [...rows];
  const store = {
    scope: vi.fn(async () => (opts.scopeExists === false ? null : { rootId: PACK, title: 'Docs', packs: [] })),
    deleteRelationsUnder: vi.fn(async () => 2),
    deleteFactsBySource: vi.fn(async (source: string) => {
      const gone = facts.filter((f) => f.source === source).map((f) => f.key);
      for (const k of gone) facts.splice(facts.findIndex((f) => f.key === k), 1);
      return { keys: gone, relations: gone.length };
    }),
    deleteScope: vi.fn(async () => opts.scopeExists !== false),
  };
  const extracted = { deleteRootSources: vi.fn(async () => opts.sources ?? 0) };
  const analysis = { clear: vi.fn(async () => undefined) };
  const graph = { cacheEnv: undefined, tenantId: 5, projectId: 11, store, extracted, analysis, repo: { linked: async () => null }, version: async () => 'v' } as unknown as KnowledgeGraphDeps;
  return { facts, store, extracted, analysis, run: (rootId: string) => deleteKnowledgeRoot({ env: {} as never, graph }, rootId) };
}

beforeEach(() => vi.clearAllMocks());

describe('deleteKnowledgeRoot', () => {
  it('refuses a reviewed root, touching nothing', async () => {
    const d = setup([]);
    expect(await d.run('web:folder-1')).toMatchObject({ ok: false, status: 400 });
    expect(d.store.deleteScope).not.toHaveBeenCalled();
    expect(mocks.bump).not.toHaveBeenCalled();
  });

  it('is 404 only when there is no scope AND nothing was deleted', async () => {
    const d = setup([], { scopeExists: false });
    expect(await d.run(PACK)).toMatchObject({ ok: false, status: 404 });
    expect(mocks.bump).not.toHaveBeenCalled();
  });

  it('clears a stranded upload that has no scope row', async () => {
    const d = setup([{ key: 'p1', source: PACK, path: 'a.md' }], { scopeExists: false, sources: 4 });
    expect(await d.run(PACK)).toMatchObject({ ok: true, facts: 1, sources: 4 });
    expect(d.facts).toHaveLength(0);
    expect(mocks.bump).toHaveBeenCalledTimes(1);
  });

  it('removes the pack by provenance and leaves same-path facts of other sources untouched', async () => {
    const d = setup([
      { key: 'p1', source: PACK, path: 'a.md' },
      { key: 'human', source: 'knowledge', path: 'a.md' },
      { key: 'agent', source: 'agent', path: 'a.md' },
      { key: 'repo', source: 'cloud:acme/app', path: 'a.md' },
    ], { sources: 2 });
    expect(await d.run(PACK)).toEqual({ ok: true, facts: 1, relations: 3, sources: 2 });
    expect(d.facts.map((f) => f.key).sort()).toEqual(['agent', 'human', 'repo']);
    expect(d.store.deleteFactsBySource).toHaveBeenCalledWith(PACK);
    expect(d.extracted.deleteRootSources).toHaveBeenCalledWith(PACK);
    expect(d.analysis.clear).toHaveBeenCalledWith(PACK);
    expect(d.store.deleteScope).toHaveBeenCalledWith(PACK);
  });

  it('removes a pack of more than 5,000 facts and 600+ sources completely', async () => {
    const d = setup(Array.from({ length: 6_200 }, (_, i) => ({ key: `p${i}`, source: PACK, path: `f${i}.md` })), { sources: 1_300 });
    expect(await d.run(PACK)).toMatchObject({ ok: true, facts: 6_200, sources: 1_300 });
    expect(d.facts).toHaveLength(0);
  });

  it('bumps the knowledge version exactly once', async () => {
    await setup([{ key: 'p1', source: PACK, path: 'a.md' }, { key: 'p2', source: PACK, path: 'b.md' }]).run(PACK);
    expect(mocks.bump).toHaveBeenCalledTimes(1);
  });
});
