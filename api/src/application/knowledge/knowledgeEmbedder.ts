/**
 * knowledgeEmbedder — the cloud {@link EmbedderPort}: bge-m3 on Workers AI (the account's
 * free quota, `MEMORY_VECTOR_SPACES.bge_m3`; operator decision: the cloud embedder stays
 * bge-m3). One embedder for every cloud knowledge index — the project graph's cards and
 * the repo definitions behind `semantic_search`.
 *
 * `known` lets a caller that already holds vectors (the repository's stored definition
 * vectors, `repoSymbolVectors.ts`) answer those texts without a Workers AI call; only the
 * rest are sent, in batches.
 */
import type { EmbedderPort } from '@seanhogg/builderforce-memory/knowledge';
import { MEMORY_VECTOR_SPACES, embedMemoryTexts, type EmbeddingEnv } from '../memory/memoryEmbedding';

export const KNOWLEDGE_EMBED_SPACE = MEMORY_VECTOR_SPACES.bge_m3;
/** Texts per Workers AI call. */
export const KNOWLEDGE_EMBED_BATCH = 96;

export function knowledgeEmbeddingAvailable(env: EmbeddingEnv): boolean {
  return KNOWLEDGE_EMBED_SPACE.available(env);
}

export function bgeM3Embedder(
  env: EmbeddingEnv,
  known?: (text: string) => Float32Array | undefined,
): EmbedderPort {
  const space = KNOWLEDGE_EMBED_SPACE;
  return {
    fingerprint: `${space.model}#${space.dims}`,
    dims: space.dims,
    async embed(texts: string[]): Promise<Float32Array[]> {
      const out: Array<Float32Array | undefined> = texts.map((t) => known?.(t));
      const missing = texts.map((t, i) => [t, i] as const).filter(([, i]) => !out[i]);
      for (let start = 0; start < missing.length; start += KNOWLEDGE_EMBED_BATCH) {
        const batch = missing.slice(start, start + KNOWLEDGE_EMBED_BATCH);
        const vectors = await embedMemoryTexts(env, batch.map(([t]) => t), space);
        if (!vectors || vectors.length !== batch.length) throw new Error('knowledge embedder: Workers AI returned no vectors');
        batch.forEach(([, i], j) => { out[i] = Float32Array.from(vectors[j]!); });
      }
      return out as Float32Array[];
    },
  };
}
