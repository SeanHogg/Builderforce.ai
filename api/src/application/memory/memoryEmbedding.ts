/**
 * Embeddings for the memory stores — the one place that decides WHICH model
 * vectors a memory, how its text is composed, and how a vector crosses into SQL.
 *
 * The model is PINNED rather than left to the embedding cascade. The cascade fails
 * over between a 2048-dimension model and a 512-dimension one, and an ANN index
 * needs a fixed width, so a failover would silently write vectors from a different
 * space into the same column. Pinning costs the failover on the write path (a
 * failed embed leaves the row unembedded and the backfill sweep retries it) and
 * buys a column whose contents are always comparable.
 *
 * Why there is still no fallback VENDOR for memory (decided 2026-10-10, after the
 * OpenRouter embedding key died and every write in the window went unembedded): the
 * second embedder the platform has, Cloudflare Workers AI BGE, answers 1024 dimensions
 * and the column is `vector(1536)`. A fallback is only sound if it produces the SAME
 * SPACE — the same model on another host — because recall compares a query vector
 * against stored ones; zero-padding a BGE vector to fit would store it, but it could
 * never be compared with a text-embedding-3-small query. The failure is therefore
 * contained rather than routed around: a write never fails on a missing vector (the
 * lexical arm still recalls it) and `memoryEmbeddingBackfill` vectorises the row once
 * the pinned model answers again. A second model means a second column (or a per-row
 * dimension) plus a recall that embeds the query once per stored model.
 *
 * That second column now exists (1256, cost lever `e3_free_embeddings`): see the vector
 * SPACES below. Each space is still one pinned model in one fixed-width column — the
 * rule above holds per space — and `memoryEmbeddingPolicy` decides which space a write
 * and a recall use.
 */

import { dispatchEmbeddingVendor } from '../llm/embeddingVendors/registry';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Env } from '../../env';

/** The credentials an embedding call reads — every space's vendor, nothing else. */
export type EmbeddingEnv = Pick<Env, 'OPENROUTER_API_KEY' | 'VOYAGE_API_KEY' | 'CLOUDFLARE_AI_API_TOKEN' | 'CLOUDFLARE_ACCOUNT_ID'>;

/**
 * The pinned memory embedding model. The `openrouter/` prefix pins the VENDOR too
 * (the cascade does not fail over across vendors for a prefixed id), which is what
 * makes the dimension below a guarantee rather than a hope.
 */
export const MEMORY_EMBEDDING_MODEL = 'openrouter/openai/text-embedding-3-small';

/** Width of {@link MEMORY_EMBEDDING_MODEL} — must match `vector(N)` in migration 1134. */
export const MEMORY_EMBEDDING_DIMS = 1536;

/** True when this deployment can embed at all (no key ⇒ lexical recall only). */
export function memoryEmbeddingAvailable(env: EmbeddingEnv): boolean {
  return Boolean(env.OPENROUTER_API_KEY);
}

// ---------------------------------------------------------------------------
// Vector SPACES (1256, cost lever `e3_free_embeddings`)
//
// The "second column" the note above says a second model needs. A space is one model
// pinned to one column width; the ANN reads (`memorySemanticRecall`) map a space to its
// column and model stamp, so nothing compares vectors across spaces:
//   legacy → `embedding`      vector(1536), text-embedding-3-small (paid, OpenRouter)
//   bge_m3 → `embedding_1024` vector(1024), Workers AI bge-m3 (free, account quota)
// The lever is on for every tenant: writes and queries use bge-m3, and recall dual-reads
// the 1536 column only for rows the free backfill sweep has not given a 1024 vector yet.
// ---------------------------------------------------------------------------

export type MemoryVectorSpaceId = 'legacy' | 'bge_m3';

export interface MemoryVectorSpace {
  id: MemoryVectorSpaceId;
  /** Vendor-prefixed, so the cascade can never answer from another model. */
  model: string;
  dims: number;
  /** Whether this deployment holds the credential the space's vendor needs. */
  available: (env: EmbeddingEnv) => boolean;
}

/** Workers AI bge-m3 — width must match `vector(1024)` in migration 1256. */
export const MEMORY_EMBEDDING_1024_MODEL = 'cloudflare/@cf/baai/bge-m3';
export const MEMORY_EMBEDDING_1024_DIMS = 1024;

export const MEMORY_VECTOR_SPACES: Readonly<Record<MemoryVectorSpaceId, MemoryVectorSpace>> = {
  legacy: { id: 'legacy', model: MEMORY_EMBEDDING_MODEL, dims: MEMORY_EMBEDDING_DIMS, available: memoryEmbeddingAvailable },
  bge_m3: {
    id: 'bge_m3',
    model: MEMORY_EMBEDDING_1024_MODEL,
    dims: MEMORY_EMBEDDING_1024_DIMS,
    available: (env) => Boolean(env.CLOUDFLARE_AI_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID),
  },
};

const LEGACY = MEMORY_VECTOR_SPACES.legacy;

/**
 * The text a memory is embedded as. Key and content together, because a memory's
 * key carries meaning the content often assumes ("deploy-command" + "pnpm deploy").
 * The query side embeds the raw question, so this must stay the ONE doc-side
 * composition — a change here without a re-embed silently misaligns the two spaces.
 */
export function memoryEmbeddingText(key: string, content: string): string {
  return `${key}\n${content}`;
}

/** A pgvector literal (`[1,2,3]`) for the driver. Rejects a wrong-width vector. */
export function toVectorLiteral(vector: readonly number[], space: MemoryVectorSpace = LEGACY): string | null {
  if (vector.length !== space.dims) return null;
  return `[${vector.map((n) => (Number.isFinite(n) ? n : 0)).join(',')}]`;
}

/**
 * Embed one or more texts with the pinned model. Returns `null` — never throws —
 * when embedding is unavailable or the vendor failed, so every caller can treat
 * "no vector" as an ordinary outcome and fall back to lexical retrieval.
 */
export async function embedMemoryTexts(env: EmbeddingEnv, input: readonly string[], space: MemoryVectorSpace = LEGACY): Promise<number[][] | null> {
  const texts = input.filter((t) => t.trim().length > 0);
  if (texts.length === 0 || !space.available(env)) return null;
  try {
    const result = await dispatchEmbeddingVendor({
      env: {
        OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
        VOYAGE_API_KEY: env.VOYAGE_API_KEY,
        CLOUDFLARE_AI_API_TOKEN: env.CLOUDFLARE_AI_API_TOKEN,
        CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      },
      model: space.model,
      input: [...texts],
    });
    const vectors = [...result.data].sort((a, b) => a.index - b.index).map((row) => row.embedding);
    if (vectors.length !== texts.length) return null;
    // A wrong-width vector means the pin did not hold; writing it would poison the
    // index, so the whole batch is refused and the rows stay unembedded.
    if (vectors.some((v) => v.length !== space.dims)) return null;
    return vectors;
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/memory/memoryEmbedding.ts',
      operation: 'embedMemoryTexts',
      level: 'warning',
      context: { space: space.id },
    });
    return null;
  }
}

/** Embed a single text. `null` on any failure, same contract as the batch form. */
export async function embedMemoryText(env: EmbeddingEnv, text: string, space: MemoryVectorSpace = LEGACY): Promise<number[] | null> {
  const vectors = await embedMemoryTexts(env, [text], space);
  return vectors?.[0] ?? null;
}

/**
 * Embed `text` in the first of `spaces` that answers, cheapest first — the ONE fallback
 * walk (a memory write, the semantic chat cache). The vector comes back with its space,
 * so a caller never compares it against another model's vectors.
 */
export async function embedInFirstSpace(
  env: EmbeddingEnv,
  text: string,
  spaces: readonly MemoryVectorSpace[],
): Promise<{ space: MemoryVectorSpace; vector: number[] } | null> {
  for (const space of spaces) {
    const vector = await embedMemoryText(env, text, space);
    if (vector) return { space, vector };
  }
  return null;
}
