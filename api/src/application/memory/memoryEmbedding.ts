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
 */

import { dispatchEmbeddingVendor } from '../llm/embeddingVendors/registry';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Env } from '../../env';

/**
 * The pinned memory embedding model. The `openrouter/` prefix pins the VENDOR too
 * (the cascade does not fail over across vendors for a prefixed id), which is what
 * makes the dimension below a guarantee rather than a hope.
 */
export const MEMORY_EMBEDDING_MODEL = 'openrouter/openai/text-embedding-3-small';

/** Width of {@link MEMORY_EMBEDDING_MODEL} — must match `vector(N)` in migration 1134. */
export const MEMORY_EMBEDDING_DIMS = 1536;

/** True when this deployment can embed at all (no key ⇒ lexical recall only). */
export function memoryEmbeddingAvailable(env: Env): boolean {
  return Boolean(env.OPENROUTER_API_KEY);
}

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
export function toVectorLiteral(vector: readonly number[]): string | null {
  if (vector.length !== MEMORY_EMBEDDING_DIMS) return null;
  return `[${vector.map((n) => (Number.isFinite(n) ? n : 0)).join(',')}]`;
}

/**
 * Embed one or more texts with the pinned model. Returns `null` — never throws —
 * when embedding is unavailable or the vendor failed, so every caller can treat
 * "no vector" as an ordinary outcome and fall back to lexical retrieval.
 */
export async function embedMemoryTexts(env: Env, input: readonly string[]): Promise<number[][] | null> {
  const texts = input.filter((t) => t.trim().length > 0);
  if (texts.length === 0 || !memoryEmbeddingAvailable(env)) return null;
  try {
    const result = await dispatchEmbeddingVendor({
      env: { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY, VOYAGE_API_KEY: env.VOYAGE_API_KEY },
      model: MEMORY_EMBEDDING_MODEL,
      input: [...texts],
    });
    const vectors = [...result.data].sort((a, b) => a.index - b.index).map((row) => row.embedding);
    if (vectors.length !== texts.length) return null;
    // A wrong-width vector means the pin did not hold; writing it would poison the
    // index, so the whole batch is refused and the rows stay unembedded.
    if (vectors.some((v) => v.length !== MEMORY_EMBEDDING_DIMS)) return null;
    return vectors;
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/memory/memoryEmbedding.ts',
      operation: 'embedMemoryTexts',
      level: 'warning',
    });
    return null;
  }
}

/** Embed a single text. `null` on any failure, same contract as the batch form. */
export async function embedMemoryText(env: Env, text: string): Promise<number[] | null> {
  const vectors = await embedMemoryTexts(env, [text]);
  return vectors?.[0] ?? null;
}
