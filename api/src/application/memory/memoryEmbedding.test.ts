import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MEMORY_EMBEDDING_DIMS,
  MEMORY_EMBEDDING_MODEL,
  embedMemoryText,
  memoryEmbeddingAvailable,
  memoryEmbeddingText,
  toVectorLiteral,
} from './memoryEmbedding';
import type { Env } from '../../env';

const dispatch = vi.fn();
vi.mock('../llm/embeddingVendors/registry', () => ({
  dispatchEmbeddingVendor: (params: unknown) => dispatch(params),
}));

afterEach(() => dispatch.mockReset());

const env = { OPENROUTER_API_KEY: 'k' } as unknown as Env;
const vector = (fill: number) => Array.from({ length: MEMORY_EMBEDDING_DIMS }, () => fill);

/**
 * GAP C2 — the write and query sides must land in the SAME vector space, which is
 * only true while the model is pinned and the width is checked. These pin both.
 */
describe('memory embeddings', () => {
  it('pins the vendor as well as the model, so the cascade cannot change the width', () => {
    expect(MEMORY_EMBEDDING_MODEL.startsWith('openrouter/')).toBe(true);
    expect(memoryEmbeddingAvailable(env)).toBe(true);
    expect(memoryEmbeddingAvailable({ VOYAGE_API_KEY: 'v' } as unknown as Env)).toBe(false);
  });

  it('composes doc-side text as key then content', () => {
    expect(memoryEmbeddingText('deploy-command', 'pnpm deploy')).toBe('deploy-command\npnpm deploy');
  });

  it('requests the pinned model and returns the vector', async () => {
    dispatch.mockResolvedValueOnce({ data: [{ index: 0, embedding: vector(0.5) }] });
    const out = await embedMemoryText(env, 'how do we deploy?');
    expect(out).toHaveLength(MEMORY_EMBEDDING_DIMS);
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ model: MEMORY_EMBEDDING_MODEL });
  });

  it('refuses a wrong-width vector rather than poisoning the index', async () => {
    dispatch.mockResolvedValueOnce({ data: [{ index: 0, embedding: [1, 2, 3] }] });
    expect(await embedMemoryText(env, 'q')).toBeNull();
  });

  it('degrades to null when the vendor throws or no key is configured', async () => {
    dispatch.mockRejectedValueOnce(new Error('502'));
    expect(await embedMemoryText(env, 'q')).toBeNull();
    expect(await embedMemoryText({} as Env, 'q')).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('toVectorLiteral', () => {
  it('renders the pgvector literal for a correctly sized vector', () => {
    expect(toVectorLiteral(vector(1))).toBe(`[${Array.from({ length: MEMORY_EMBEDDING_DIMS }, () => '1').join(',')}]`);
  });

  it('rejects a vector of the wrong width and an empty one', () => {
    expect(toVectorLiteral([1, 2, 3])).toBeNull();
    expect(toVectorLiteral([])).toBeNull();
  });
});
