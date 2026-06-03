/**
 * Canonical read-through cache: L1 in-isolate Map + L2 Workers KV.
 *
 * Use this for read-heavy / expensive paths (DB round-trips, fan-out, stable
 * recomputation) instead of an ad-hoc `Map + TTL` (which never propagates
 * cross-isolate). The L1 Map lives here — the one place a per-isolate cache is
 * acceptable — and is backed by the shared KV namespace so a value populated on
 * one isolate is visible to others.
 *
 * Pattern: cache on read, invalidate on write. For an unbounded keyspace (e.g.
 * search) fold a version token into the key so old entries age out naturally.
 *
 * The KV binding (`AUTH_CACHE_KV`) is optional — when unbound, every call falls
 * straight through to the loader, so caching is opt-in via wrangler.toml without
 * touching call sites.
 */

import type { Env } from '../../env';

type L1Entry = { value: unknown; expiresAt: number };

/** Per-isolate L1 layer. Short TTL — KV is the cross-isolate source of truth. */
const l1 = new Map<string, L1Entry>();
const L1_TTL_MS = 30_000;
const DEFAULT_KV_TTL_SECONDS = 300;

function kvKey(key: string): string {
  return `cache:${key}`;
}

/**
 * Return the cached value for `key`, or compute it via `loader`, cache it in
 * both layers, and return it. KV/L1 errors degrade to a direct loader call.
 */
export async function getOrSetCached<T>(
  env: Env,
  key: string,
  loader: () => Promise<T>,
  opts?: { kvTtlSeconds?: number; l1TtlMs?: number },
): Promise<T> {
  const now = Date.now();

  const hit = l1.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  if (hit) l1.delete(key);

  const kv = env.AUTH_CACHE_KV;
  const l1Ttl = opts?.l1TtlMs ?? L1_TTL_MS;

  if (kv) {
    try {
      const cached = (await kv.get(kvKey(key), 'json')) as T | null;
      if (cached != null) {
        l1.set(key, { value: cached, expiresAt: now + l1Ttl });
        return cached;
      }
    } catch {
      // KV read failures never fail the request — fall through to the loader.
    }
  }

  const fresh = await loader();
  l1.set(key, { value: fresh, expiresAt: now + l1Ttl });
  if (kv) {
    try {
      await kv.put(kvKey(key), JSON.stringify(fresh), {
        expirationTtl: opts?.kvTtlSeconds ?? DEFAULT_KV_TTL_SECONDS,
      });
    } catch {
      // Best-effort write — a miss next time is acceptable.
    }
  }
  return fresh;
}

/** Invalidate both cache layers for `key`. Call from every mutation that
 *  changes the cached data so the next read re-loads. */
export async function invalidateCached(env: Env, key: string): Promise<void> {
  l1.delete(key);
  const kv = env.AUTH_CACHE_KV;
  if (kv) {
    try {
      await kv.delete(kvKey(key));
    } catch {
      // Invalidation failure degrades to "wait for the KV TTL" — acceptable.
    }
  }
}
