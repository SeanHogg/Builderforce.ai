/**
 * Shared (L2) semantic response cache — the cross-surface tier of the
 * SemanticCache in `@builderforce/memory`.
 *
 * A paraphrased prompt answered by the web app or by an agent is stored here
 * keyed by its embedding, so the *other* surface can reuse the answer instead of
 * re-billing the frontier model. Per tenant+namespace partition we keep a
 * bounded list of {embedding, response} in `SEMANTIC_CACHE_KV` and brute-force
 * cosine over it on lookup — fine at the bounded list size; see the gap register
 * for the Vectorize upgrade path for unbounded scale.
 *
 * The partition-list read goes through the canonical `getOrSetCached`
 * (L1 in-isolate + L2 KV) and is invalidated on every write, so repeated
 * lookups in one isolate don't re-hit KV. When `SEMANTIC_CACHE_KV` is unbound
 * the whole thing degrades to miss/no-op (clients then run local-only).
 */

import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { cosineSimilarity } from './vectorMath';

/** One stored association. `e` = embedding, `r` = response, `t` = stored-at ms. */
interface SemanticEntry { e: number[]; r: string; t: number }

/** Max entries retained per partition (brute-force scan stays cheap). */
const MAX_ENTRIES_PER_PARTITION = 200;
/** Hard cap on embedding dimensionality accepted, to bound KV value size. */
const MAX_EMBEDDING_DIMS = 4096;

function partitionKey(tenantId: number, namespace: string): string {
  return `semcache:${tenantId}:${namespace}`;
}

// cosineSimilarity now lives in the zero-dep ./vectorMath (one tested copy — the
// Worker bundle still can't pull @builderforce/memory's WebGPU engine for it).

/** Reads a partition's entries through the L1+L2 read-through cache. */
async function readPartition(env: Env, tenantId: number, namespace: string): Promise<SemanticEntry[]> {
  const key = partitionKey(tenantId, namespace);
  return getOrSetCached<SemanticEntry[]>(
    env,
    key,
    async () => {
      const kv = env.SEMANTIC_CACHE_KV;
      if (!kv) return [];
      const stored = (await kv.get(key, 'json').catch(() => null)) as SemanticEntry[] | null;
      return Array.isArray(stored) ? stored : [];
    },
    { kvTtlSeconds: 60, l1TtlMs: 15_000 },
  );
}

/**
 * Returns the best-matching cached response at/above `threshold`, or null.
 */
export async function semanticLookup(
  env: Env,
  tenantId: number,
  namespace: string,
  embedding: number[],
  threshold: number,
): Promise<{ response: string; score: number } | null> {
  if (!Array.isArray(embedding) || embedding.length === 0) return null;
  const entries = await readPartition(env, tenantId, namespace);

  let best: SemanticEntry | undefined;
  let bestScore = -Infinity;
  for (const entry of entries) {
    const score = cosineSimilarity(embedding, entry.e);
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  return best && bestScore >= threshold ? { response: best.r, score: bestScore } : null;
}

/**
 * Stores an embedding → response association, trimming the partition to its
 * bound (newest kept) and invalidating the read-through cache.
 * No-op when `SEMANTIC_CACHE_KV` is unbound.
 */
export async function semanticStore(
  env: Env,
  tenantId: number,
  namespace: string,
  embedding: number[],
  response: string,
): Promise<void> {
  const kv = env.SEMANTIC_CACHE_KV;
  if (!kv) return;
  if (!Array.isArray(embedding) || embedding.length === 0 || embedding.length > MAX_EMBEDDING_DIMS) return;
  if (typeof response !== 'string' || response.length === 0) return;

  const key = partitionKey(tenantId, namespace);
  // Read the durable source directly (not the cache) so we trim against truth.
  const current = ((await kv.get(key, 'json').catch(() => null)) as SemanticEntry[] | null) ?? [];
  const next = [{ e: embedding, r: response, t: Date.now() }, ...current].slice(0, MAX_ENTRIES_PER_PARTITION);

  await kv.put(key, JSON.stringify(next)).catch(() => { /* best-effort */ });
  await invalidateCached(env, key);
}
