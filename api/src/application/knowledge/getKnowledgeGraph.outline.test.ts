/**
 * The outline of a truncated graph: cached once per root (not per focus variant), attached on
 * read, and left off for callers that do not read it (search).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Extracted } from '@seanhogg/builderforce-memory/knowledge';

const loaded = vi.hoisted(() => [] as string[]);
vi.mock('../../infrastructure/cache/readThroughCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../infrastructure/cache/readThroughCache')>();
  return {
    ...actual,
    getOrSetCached: ((env: never, key: string, loader: () => Promise<unknown>, opts: never) =>
      (actual.getOrSetCached as (...a: unknown[]) => Promise<unknown>)(env, key, async () => { loaded.push(key); return loader(); }, opts)) as typeof actual.getOrSetCached,
  };
});

import { getKnowledgeGraph, knowledgeOutlineCacheKey, type KnowledgeGraphDeps } from './getKnowledgeGraph';

const ROOT = 'web:outline-root:';
const file = (path: string): Extracted => ({
  sourceRef: `src:${ROOT}::${path}`, sourceHash: `h:${path}`,
  nodes: [{ ref: `src:${ROOT}::${path}`, kind: 'file', label: path, pack: 'docs', importance: 0, origin: 'extracted', sourceHash: `h:${path}` }],
  edges: [], keys: [],
});

function deps(version: string): KnowledgeGraphDeps {
  const extracted = [file('docs/a.md'), file('docs/b.md'), file('docs/c.md')];
  return {
    cacheEnv: undefined, tenantId: 41, projectId: 7,
    store: {
      scopes: vi.fn(async () => []), scope: vi.fn(async () => ({ rootId: ROOT, title: 'Root', packs: ['docs'], lastDigest: 'd1' })),
      facts: vi.fn(async () => []), relations: vi.fn(async () => []), upsertRelations: vi.fn(async () => 0), upsertScope: vi.fn(async () => undefined),
      markRelationsStale: vi.fn(async () => 0), deleteRelationsOf: vi.fn(async () => 0), deleteScope: vi.fn(async () => true), factSources: vi.fn(async () => new Map<string, string>()),
      deleteFactsBySource: vi.fn(async () => []), deleteRelationsUnder: vi.fn(async () => 0), factAuthor: vi.fn(async () => null),
    },
    extracted: {
      get: vi.fn(async () => undefined), put: vi.fn(async () => undefined), setSource: vi.fn(async () => undefined),
      rootExtracted: vi.fn(async () => extracted), snapshotReview: vi.fn(async () => undefined), reviewExtracted: vi.fn(async () => null),
    },
    analysis: { put: vi.fn(), clear: vi.fn(), latest: vi.fn(async () => null) },
    repo: { linked: async () => null },
    version: async () => version,
  };
}

describe('getKnowledgeGraph outline', () => {
  it('attaches the outline of a truncated graph on read, and none to an untruncated one', async () => {
    const d = deps('outline-v1');
    const cut = await getKnowledgeGraph(d, { rootId: ROOT, maxNodes: 1 });
    expect(cut?.stats.truncated).toBe(true);
    expect(cut?.outline?.files).toHaveLength(3);
    const whole = await getKnowledgeGraph(d, { rootId: ROOT, maxNodes: 100 });
    expect(whole?.stats.truncated).toBe(false);
    expect(whole?.outline).toBeUndefined();
  });

  it('writes the outline once for two focus variants', async () => {
    loaded.length = 0;
    const d = deps('outline-v2');
    const a = await getKnowledgeGraph(d, { rootId: ROOT, maxNodes: 1 });
    const b = await getKnowledgeGraph(d, { rootId: ROOT, maxNodes: 1, focus: [`src:${ROOT}::docs/c.md`] });
    expect(loaded.filter((k) => k.startsWith('kg:v5:'))).toHaveLength(2);
    expect(loaded.filter((k) => k.startsWith('kg-outline:v1:'))).toEqual([
      knowledgeOutlineCacheKey({ tenantId: 41, projectId: 7, rootId: ROOT, scopeDigest: loaded.find((k) => k.startsWith('kg-outline:'))!.split(':').slice(-2)[0]!, version: 'outline-v2' }),
    ]);
    expect(b?.outline).toEqual(a?.outline);
  });

  it('leaves the outline off when the caller does not read it (search)', async () => {
    loaded.length = 0;
    const graph = await getKnowledgeGraph(deps('outline-v3'), { rootId: ROOT, maxNodes: 1, outline: false });
    expect(graph?.stats.truncated).toBe(true);
    expect(graph?.outline).toBeUndefined();
    expect(loaded.some((k) => k.startsWith('kg-outline:'))).toBe(false);
  });
});
