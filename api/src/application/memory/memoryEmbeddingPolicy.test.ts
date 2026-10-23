import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEMORY_EMBEDDING_1024_MODEL, MEMORY_EMBEDDING_DIMS, MEMORY_EMBEDDING_MODEL, MEMORY_EMBEDDING_1024_DIMS } from './memoryEmbedding';
import { memoryEmbeddingFieldsFor, memoryQueryVectors, NO_MEMORY_EMBEDDING, backfill1024DrainedKey } from './memoryEmbeddingPolicy';
import { __clearL1CacheForTests, setCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

const dispatch = vi.fn();
vi.mock('../llm/embeddingVendors/registry', () => ({
  dispatchEmbeddingVendor: (params: unknown) => dispatch(params),
}));

afterEach(() => {
  dispatch.mockReset();
  __clearL1CacheForTests();
});

const keys = { OPENROUTER_API_KEY: 'k', CLOUDFLARE_AI_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' };
const off = { ...keys, COST_LEVER_E3_FREE_EMBEDDINGS: 'off' } as unknown as Env;
const on = { ...keys, COST_LEVER_E3_FREE_EMBEDDINGS: 'on' } as unknown as Env;
const vec = (dims: number) => Array.from({ length: dims }, () => 0.25);

/** Answer each dispatch with a vector of the width its pinned model produces. */
function answerByModel(failModel?: string) {
  dispatch.mockImplementation(async (p: { model: string; input: string[] }) => {
    if (p.model === failModel) throw new Error('vendor down');
    const dims = p.model === MEMORY_EMBEDDING_1024_MODEL ? MEMORY_EMBEDDING_1024_DIMS : MEMORY_EMBEDDING_DIMS;
    return { data: p.input.map((_, index) => ({ index, embedding: vec(dims) })) };
  });
}

describe('memoryEmbeddingFieldsFor (E3 write side)', () => {
  it('lever off: the 1536 vector, and the 1024 column cleared', async () => {
    answerByModel();
    const f = await memoryEmbeddingFieldsFor(off, 1, 'k\nv');
    expect(f.embeddingModel).toBe(MEMORY_EMBEDDING_MODEL);
    expect(f.embedding).toMatch(/^\[/);
    expect([f.embedding1024, f.embedding1024Model, f.embedded1024At]).toEqual([null, null, null]);
    expect(dispatch.mock.calls.map((c) => c[0].model)).toEqual([MEMORY_EMBEDDING_MODEL]);
  });

  it('lever on: the free bge-m3 vector only, the stale 1536 one cleared', async () => {
    answerByModel();
    const f = await memoryEmbeddingFieldsFor(on, 1, 'k\nv');
    expect(f.embedding1024Model).toBe(MEMORY_EMBEDDING_1024_MODEL);
    expect(f.embedding).toBeNull();
    expect(dispatch.mock.calls.map((c) => c[0].model)).toEqual([MEMORY_EMBEDDING_1024_MODEL]);
  });

  it('lever on but bge-m3 down: falls back to the 1536 space', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answerByModel(MEMORY_EMBEDDING_1024_MODEL);
    const f = await memoryEmbeddingFieldsFor(on, 1, 'k\nv');
    expect(f.embeddingModel).toBe(MEMORY_EMBEDDING_MODEL);
    expect(f.embedding1024).toBeNull();
  });

  it('nothing can embed: every column null, the write still proceeds', async () => {
    expect(await memoryEmbeddingFieldsFor({} as Env, 1, 'k\nv')).toEqual(NO_MEMORY_EMBEDDING);
  });
});

describe('memoryQueryVectors (E3 read side)', () => {
  it('lever off: one 1536 query vector', async () => {
    answerByModel();
    const v = await memoryQueryVectors(off, 1, 'how do we deploy?');
    expect(v.map((x) => [x.space.id, x.onlyRowsLacking])).toEqual([['legacy', undefined]]);
  });

  it('lever on: bge-m3 plus the 1536 fallback restricted to rows without a 1024 vector', async () => {
    answerByModel();
    const v = await memoryQueryVectors(on, 1, 'how do we deploy?');
    expect(v.map((x) => [x.space.id, x.onlyRowsLacking])).toEqual([['bge_m3', undefined], ['legacy', 'bge_m3']]);
  });

  it('lever on and the backfill drained: no paid fallback query embed', async () => {
    answerByModel();
    const env = { ...on, AUTH_CACHE_KV: undefined } as unknown as Env;
    await setCached(env, backfill1024DrainedKey('project_facts'), true);
    const v = await memoryQueryVectors(env, 1, 'q', ['project_facts']);
    expect(v.map((x) => x.space.id)).toEqual(['bge_m3']);
    expect(dispatch.mock.calls.map((c) => c[0].model)).toEqual([MEMORY_EMBEDDING_1024_MODEL]);
  });

  it('lever on but bge-m3 down: the 1536 vector unrestricted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answerByModel(MEMORY_EMBEDDING_1024_MODEL);
    const v = await memoryQueryVectors(on, 1, 'q');
    expect(v.map((x) => [x.space.id, x.onlyRowsLacking])).toEqual([['legacy', undefined]]);
  });

  it('an empty query embeds nothing', async () => {
    expect(await memoryQueryVectors(on, 1, '  ')).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
