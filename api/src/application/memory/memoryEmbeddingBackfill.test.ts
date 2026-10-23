import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKFILL_1024_BATCHES, backfill1024CursorKey, runMemoryEmbeddingBackfill } from './memoryEmbeddingBackfill';
import { backfill1024DrainedKey } from './memoryEmbeddingPolicy';
import { MEMORY_EMBEDDING_1024_DIMS, MEMORY_EMBEDDING_1024_MODEL, MEMORY_EMBEDDING_DIMS } from './memoryEmbedding';
import { __clearL1CacheForTests, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

const doubles = vi.hoisted(() => ({
  dispatch: vi.fn(),
  inSpace: vi.fn(),
  legacyMemories: vi.fn(async () => [] as Array<{ id: string; key: string; content: string }>),
  legacyFacts: vi.fn(async () => [] as Array<{ id: string; key: string; content: string }>),
}));

vi.mock('../llm/embeddingVendors/registry', () => ({
  dispatchEmbeddingVendor: (params: unknown) => doubles.dispatch(params),
}));
vi.mock('./memorySemanticRecall', async () => {
  const actual = await vi.importActual<typeof import('./memorySemanticRecall')>('./memorySemanticRecall');
  return {
    ...actual,
    unembeddedInSpace: doubles.inSpace,
    unembeddedMemories: doubles.legacyMemories,
    unembeddedProjectFacts: doubles.legacyFacts,
  };
});

afterEach(() => {
  doubles.dispatch.mockReset();
  doubles.inSpace.mockReset();
  __clearL1CacheForTests();
});

function answerByModel() {
  doubles.dispatch.mockImplementation(async (p: { model: string; input: string[] }) => {
    const dims = p.model === MEMORY_EMBEDDING_1024_MODEL ? MEMORY_EMBEDDING_1024_DIMS : MEMORY_EMBEDDING_DIMS;
    return { data: p.input.map((_, index) => ({ index, embedding: Array.from({ length: dims }, () => 0.5) })) };
  });
}

function updatesDb() {
  const sets: Array<Record<string, unknown>> = [];
  const db = { update: () => ({ set: (s: Record<string, unknown>) => { sets.push(s); return { where: async () => undefined }; } }) };
  return { db: db as never, sets };
}

const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${String(from + i).padStart(4, '0')}`, key: `k${from + i}`, content: 'c' }));
const cfOnly = { CLOUDFLARE_AI_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' } as unknown as Env;

describe('runMemoryEmbeddingBackfill — bge-m3 space (1256)', () => {
  it('skips entirely when neither space has a credential', async () => {
    const { db } = updatesDb();
    expect(await runMemoryEmbeddingBackfill({} as Env, db)).toEqual({ memories: 0, projectFacts: 0, skipped: 'no_embedding_key' });
  });

  it('runs the free space without an OpenRouter key and writes only the 1024 columns', async () => {
    answerByModel();
    doubles.inSpace.mockImplementation(async (_db: unknown, store: string, _space: string, after: string) =>
      store === 'agent_memory' && after === '' ? rows(0, 2) : []);
    const { db, sets } = updatesDb();
    const r = await runMemoryEmbeddingBackfill(cfOnly, db, 4);
    expect(r.bySpace).toEqual({ legacy: { memories: 0, projectFacts: 0 }, bge_m3: { memories: 2, projectFacts: 0 } });
    expect(sets).toHaveLength(2);
    expect(Object.keys(sets[0]!).sort()).toEqual(['embedded1024At', 'embedding1024', 'embedding1024Model']);
    expect(sets[0]!.embedding1024Model).toBe(MEMORY_EMBEDDING_1024_MODEL);
    expect(doubles.legacyMemories).not.toHaveBeenCalled();
  });

  it('walks keyset batches from the persisted cursor and resumes where it stopped', async () => {
    answerByModel();
    await setCached(cfOnly, backfill1024CursorKey('agent_memory'), 'id-0100');
    const afters: string[] = [];
    doubles.inSpace.mockImplementation(async (_db: unknown, store: string, _space: string, after: string) => {
      if (store !== 'agent_memory') return [];
      afters.push(after);
      const start = after ? Number(after.slice(3)) + 1 : 0;
      return rows(start, 2); // always a full batch: the table never ends this run
    });
    const { db } = updatesDb();
    await runMemoryEmbeddingBackfill(cfOnly, db, 2);
    expect(afters[0]).toBe('id-0100');
    expect(afters).toHaveLength(BACKFILL_1024_BATCHES);
    expect(await peekCached<string>(cfOnly, backfill1024CursorKey('agent_memory'))).toBe(`id-${String(100 + 2 * BACKFILL_1024_BATCHES).padStart(4, '0')}`);
  });

  it('wraps the cursor on a short batch and marks the store drained on an empty lap', async () => {
    answerByModel();
    doubles.inSpace.mockImplementation(async (_db: unknown, store: string, _space: string, after: string) =>
      store === 'project_facts' && after === '' ? [] : store === 'agent_memory' && after === '' ? rows(0, 1) : []);
    const { db } = updatesDb();
    await runMemoryEmbeddingBackfill(cfOnly, db, 4);
    expect(await peekCached<string>(cfOnly, backfill1024CursorKey('agent_memory'))).toBe('');
    expect(await peekCached<boolean>(cfOnly, backfill1024DrainedKey('agent_memory'))).toBe(false);
    expect(await peekCached<boolean>(cfOnly, backfill1024DrainedKey('project_facts'))).toBe(true);
  });

  it('does not advance past a batch the vendor would not embed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    doubles.dispatch.mockRejectedValue(new Error('vendor down'));
    doubles.inSpace.mockImplementation(async (_db: unknown, store: string) => (store === 'agent_memory' ? rows(5, 2) : []));
    const { db } = updatesDb();
    await runMemoryEmbeddingBackfill(cfOnly, db, 2);
    expect(doubles.inSpace.mock.calls.filter((c) => c[1] === 'agent_memory')).toHaveLength(1);
    expect(await peekCached<string>(cfOnly, backfill1024CursorKey('agent_memory'))).toBe('');
  });
});
