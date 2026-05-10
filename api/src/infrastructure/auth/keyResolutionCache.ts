/**
 * Optional KV-backed cache for API-key → tenant resolution.
 *
 * Hit path: ~1ms (KV read). Miss path: ~30-80ms (Neon round-trip from a
 * Worker). After the first call for any given key, every subsequent call
 * for the next year is a cache hit.
 *
 * Cache key format:  `auth:<keyType>:<sha256(rawKey)>`
 * Cached value:      JSON-encoded ResolvedKey envelope, or `{revoked: true}`
 *                    tombstone written by mutation handlers to invalidate
 *                    a still-cached entry.
 *
 * **TTL is intentionally long (365 days) because every mutation that
 * affects auth resolution explicitly calls `invalidateKeyCache`** —
 * specifically: revoke, update (origin allowlist / name), claw deactivation,
 * claw daily-limit change. Mint creates no cache entry to invalidate (the
 * first call populates it). Tenant plan/billing changes don't need
 * invalidation because `resolveTenantPlan` runs fresh on every request,
 * outside the cached block.
 *
 * If you add a new mutation that changes auth resolution, you MUST call
 * `invalidateKeyCache` from that handler — otherwise the change won't take
 * effect for up to a year.
 *
 * The KV binding (`AUTH_CACHE_KV`) is *optional* — when not bound, every
 * call falls through to the loader (DB). Single helper so caching is opt-in
 * via wrangler.toml without touching call sites.
 */

import type { Env } from '../../env';

/** 365 days. Long-lived because mutations invalidate explicitly. */
const TTL_SECONDS = 365 * 24 * 60 * 60;
/** Tombstone TTL — long enough that any in-flight cached entry is dead, then auto-cleans. */
const TOMBSTONE_TTL_SECONDS = 60 * 60;

/** What the loader returns; gateway auth uses this to populate TenantAccess. */
export type ResolvedKey =
  | { ok: true;  payload: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Look up a key, consulting the KV cache first when available.
 * `loader` is called on cache miss (or when cache is unbound) and its result
 * is written back to the cache with a 60s TTL.
 */
export async function resolveKeyCached(
  env: Env,
  keyType: 'bfk' | 'clk',
  hash: string,
  loader: () => Promise<ResolvedKey>,
): Promise<ResolvedKey> {
  const kv = env.AUTH_CACHE_KV;
  if (!kv) return loader();

  const cacheKey = `auth:${keyType}:${hash}`;
  try {
    const cached = await kv.get(cacheKey, 'json') as ResolvedKey | { revoked: true } | null;
    if (cached) {
      // Tombstone written by `invalidateKeyCache` when a key is revoked
      // mid-TTL. Treat as a miss and re-load (the loader will return a
      // not-found / revoked envelope from the DB).
      if ('revoked' in cached) return loader().then(async (fresh) => {
        await writeCache(kv, cacheKey, fresh).catch(() => undefined);
        return fresh;
      });
      return cached as ResolvedKey;
    }
  } catch {
    // KV read errors should never fail the request — fall through to DB.
  }

  const fresh = await loader();
  await writeCache(kv, cacheKey, fresh).catch(() => undefined);
  return fresh;
}

/**
 * Invalidate a key's cache entry. Call after revocation so the next request
 * doesn't honour a stale "valid" cache for up to TTL_SECONDS.
 *
 * Writes a short-lived tombstone so the *next* request misses the cache and
 * re-loads from the DB (which will then see the `revoked_at` timestamp and
 * cache the correct "rejected" state).
 */
export async function invalidateKeyCache(env: Env, keyType: 'bfk' | 'clk', hash: string): Promise<void> {
  const kv = env.AUTH_CACHE_KV;
  if (!kv) return;
  const cacheKey = `auth:${keyType}:${hash}`;
  try {
    await kv.put(cacheKey, JSON.stringify({ revoked: true }), { expirationTtl: TOMBSTONE_TTL_SECONDS });
  } catch {
    // Cache invalidation failures degrade to "wait for the existing TTL to expire" — acceptable.
  }
}

async function writeCache(kv: KVNamespace, key: string, value: ResolvedKey): Promise<void> {
  await kv.put(key, JSON.stringify(value), { expirationTtl: TTL_SECONDS });
}
