import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Shared (L2) semantic response cache — the cross-surface tier of the
 * `SemanticCache` in `@seanhogg/builderforce-memory`.
 *
 * A paraphrased prompt answered by the web app or by an agent is stored here keyed
 * by its embedding, so the *other* surface can reuse the answer instead of re-billing
 * the frontier model.
 *
 * ── WHY THIS IS AN INDEX AND NOT A LIST ────────────────────────────────────
 * The first version kept ONE bounded list per tenant+namespace and brute-forced
 * cosine over it. That has two problems and only one of them is speed: the list was
 * capped at 200 entries, so a busy namespace silently evicted its own hits and the
 * cache's hit rate fell as it was used more — the opposite of what a cache is for.
 * Raising the cap only moves the failure, because the whole partition is one KV value
 * that must be read, parsed, and re-written on every store.
 *
 * This is a real keyed index instead: RANDOM-HYPERPLANE LSH. Each embedding is
 * reduced to {@link HASH_TABLES} independent signatures of {@link HASH_BITS} bits
 * (`sign(v · hᵢ)` against a deterministic pseudo-random hyperplane set), and each
 * signature is a KV KEY. A lookup reads the {@link HASH_TABLES} buckets the query
 * lands in — a fixed, small number of point reads — and never scans the corpus. Two
 * vectors collide in one table with probability `(1 − θ/π)^k`, so several independent
 * tables recover the recall a single one loses; at the 0.92 threshold this surface
 * uses, four tables of six bits put recall around 90% while keeping the cost at four
 * reads and four writes regardless of how much is stored.
 *
 * Capacity is now bounded PER BUCKET rather than per tenant, so the corpus grows with
 * the number of distinct questions instead of being truncated to the most recent 200.
 *
 * ── BINDING ────────────────────────────────────────────────────────────────
 * `SEMANTIC_CACHE_KV` is the preferred namespace, but this DEGRADES TO
 * `AUTH_CACHE_KV` when it is unbound rather than turning itself off. That is
 * deliberate: the dedicated namespace is an isolation nicety, and waiting on an ops
 * task to provision one meant the feature was a permanent no-op in production —
 * every `FetchSemanticCacheBackend` client (web and agent-runtime) was already wired
 * and getting nothing back. The `semcache:` key prefix keeps the two concerns apart
 * inside a shared namespace exactly as `cooldown:` and `auth:` already are.
 */

import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { cosineSimilarity } from './vectorMath';

/** One stored association. `e` = embedding, `r` = response, `t` = stored-at ms. */
interface SemanticEntry { e: number[]; r: string; t: number }

/**
 * Independent hash tables. More tables = higher recall at linearly more KV
 * operations. Four is the knee for this surface's 0.92 threshold (~90% recall).
 */
const HASH_TABLES = 4;
/** Bits per signature. More bits = smaller, more precise buckets, lower recall. */
const HASH_BITS = 6;
/** Max entries retained per BUCKET. Total capacity is this × 2^HASH_BITS × tables,
 *  which is orders of magnitude past the 200-entry whole-partition cap it replaces. */
const MAX_ENTRIES_PER_BUCKET = 64;
/** Hard cap on embedding dimensionality accepted, to bound KV value size. */
const MAX_EMBEDDING_DIMS = 4096;

/** Preferred namespace, falling back to the shared one — see the binding note above. */
function semanticKv(env: Env): KVNamespace | undefined {
  return env.SEMANTIC_CACHE_KV ?? env.AUTH_CACHE_KV;
}

function bucketKey(tenantId: number, namespace: string, table: number, signature: number): string {
  return `semcache:${tenantId}:${namespace}:t${table}:${signature.toString(36)}`;
}

/**
 * Deterministic pseudo-random hyperplane component for (table, bit, dimension).
 *
 * Generated rather than stored: a persisted hyperplane matrix would be one more
 * thing to provision, version and keep in sync between the writer and the reader —
 * and getting it out of step would not fail loudly, it would quietly stop finding
 * hits. A pure function of the indices cannot drift. The mix is a standard integer
 * hash (xorshift-multiply); its only requirements are determinism and no correlation
 * between adjacent dimensions.
 */
function hyperplaneComponent(table: number, bit: number, dim: number): number {
  let h = (table * 0x9e3779b1) ^ (bit * 0x85ebca6b) ^ (dim * 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h = Math.imul(h ^ (h >>> 13), 0x9e3779b1);
  h ^= h >>> 16;
  // Map to [-1, 1). Sign is what matters; magnitude only weights the projection.
  return ((h >>> 0) / 0x80000000) - 1;
}

/**
 * The {@link HASH_TABLES} bucket signatures an embedding belongs to. PURE — the same
 * vector always produces the same buckets, which is what makes the index readable by
 * a different isolate than the one that wrote it.
 */
export function signaturesFor(embedding: readonly number[]): number[] {
  const out: number[] = [];
  for (let table = 0; table < HASH_TABLES; table += 1) {
    let signature = 0;
    for (let bit = 0; bit < HASH_BITS; bit += 1) {
      let dot = 0;
      for (let dim = 0; dim < embedding.length; dim += 1) {
        dot += embedding[dim]! * hyperplaneComponent(table, bit, dim);
      }
      if (dot >= 0) signature |= 1 << bit;
    }
    out.push(signature);
  }
  return out;
}

/** Read ONE bucket through the L1+L2 read-through cache. */
async function readBucket(env: Env, key: string): Promise<SemanticEntry[]> {
  return getOrSetCached<SemanticEntry[]>(
    env,
    key,
    async () => {
      const kv = semanticKv(env);
      if (!kv) return [];
      const stored = (await kv.get(key, 'json').catch(() => null)) as SemanticEntry[] | null;
      return Array.isArray(stored) ? stored : [];
    },
    { kvTtlSeconds: 60, l1TtlMs: 15_000 },
  );
}

/**
 * Best-matching cached response at/above `threshold`, or null.
 *
 * Reads exactly {@link HASH_TABLES} buckets — a fixed cost that does not grow with
 * the corpus. Cosine is still computed exactly, over the handful of CANDIDATES the
 * index returned rather than over everything stored: LSH decides what to compare,
 * never what matches, so a hit returned here is a true hit at the real threshold.
 */
export async function semanticLookup(
  env: Env,
  tenantId: number,
  namespace: string,
  embedding: number[],
  threshold: number,
): Promise<{ response: string; score: number } | null> {
  if (!Array.isArray(embedding) || embedding.length === 0) return null;
  const signatures = signaturesFor(embedding);
  const buckets = await Promise.all(
    signatures.map((sig, table) => readBucket(env, bucketKey(tenantId, namespace, table, sig)).catch(() => [])),
  );

  let best: SemanticEntry | undefined;
  let bestScore = -Infinity;
  const seen = new Set<string>();
  for (const bucket of buckets) {
    for (const entry of bucket) {
      // The same association lives in every table it hashed into; score it once.
      if (seen.has(entry.r)) continue;
      seen.add(entry.r);
      const score = cosineSimilarity(embedding, entry.e);
      if (score > bestScore) { bestScore = score; best = entry; }
    }
  }
  return best && bestScore >= threshold ? { response: best.r, score: bestScore } : null;
}

/**
 * Store an embedding → response association into every bucket it hashes to,
 * trimming each to its bound (newest kept) and invalidating the read-through cache.
 * No-op when no KV namespace is bound at all.
 */
export async function semanticStore(
  env: Env,
  tenantId: number,
  namespace: string,
  embedding: number[],
  response: string,
): Promise<void> {
  const kv = semanticKv(env);
  if (!kv) return;
  if (!Array.isArray(embedding) || embedding.length === 0 || embedding.length > MAX_EMBEDDING_DIMS) return;
  if (typeof response !== 'string' || response.length === 0) return;

  const entry: SemanticEntry = { e: embedding, r: response, t: Date.now() };
  const signatures = signaturesFor(embedding);
  await Promise.all(signatures.map(async (sig, table) => {
    const key = bucketKey(tenantId, namespace, table, sig);
    // Read the durable source directly (not the cache) so we trim against truth.
    const current = ((await kv.get(key, 'json').catch(() => null)) as SemanticEntry[] | null) ?? [];
    const next = [entry, ...current.filter((e) => e.r !== response)].slice(0, MAX_ENTRIES_PER_BUCKET);
    await kv.put(key, JSON.stringify(next)).catch((error) => { /* best-effort */
      reportCaughtError(error, { source: 'application/llm/semanticCache.ts', operation: 'semanticStore' });
    });
    await invalidateCached(env, key);
  }));
}

/**
 * Purge one security partition.
 *
 * The index is spread across up to `HASH_TABLES × 2^HASH_BITS` keys, and KV cannot
 * enumerate them cheaply — so the partition carries a VERSION TOKEN that every bucket
 * key would have to embed for a bulk purge to be one write. It does not, deliberately:
 * a purge is a rare administrative act and correctness matters more than its cost, so
 * this deletes every bucket the partition can own. Bounded and exact.
 */
export async function semanticInvalidate(env: Env, tenantId: number, namespace: string): Promise<void> {
  const kv = semanticKv(env);
  const keys: string[] = [];
  for (let table = 0; table < HASH_TABLES; table += 1) {
    for (let sig = 0; sig < (1 << HASH_BITS); sig += 1) {
      keys.push(bucketKey(tenantId, namespace, table, sig));
    }
  }
  await Promise.all(keys.map(async (key) => {
    await kv?.delete(key).catch((error) => {
      reportCaughtError(error, { source: 'application/llm/semanticCache.ts', operation: 'semanticInvalidate' });
    });
    await invalidateCached(env, key);
  }));
}
