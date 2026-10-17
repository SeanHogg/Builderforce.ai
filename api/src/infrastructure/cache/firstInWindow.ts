/**
 * "Has this happened yet in the current window?" on the ONE read-through cache.
 *
 * For best-effort side effects that only need to happen once per window (a
 * recurring error forwarded to Quality, a daily metrics snapshot taken from a read
 * path). The marker lives in L1 (this isolate) and KV (across isolates), so a
 * repeat inside the window costs no database statement at all. Two isolates racing
 * on a cold key can both see "first"; callers must therefore be idempotent (an
 * upsert on a natural key, a deduplicating sink), which is why this is a throttle
 * and not a lock. Without a KV binding every call is "first" — the side effect
 * simply runs, as it did before the throttle.
 */
import { getOrSetCached, type CacheEnv } from './readThroughCache';

export async function firstInWindow(env: CacheEnv, key: string, windowSeconds: number): Promise<boolean> {
  let first = false;
  await getOrSetCached(env, key, async () => { first = true; return 1; }, {
    kvTtlSeconds: windowSeconds,
    l1TtlMs: windowSeconds * 1000,
  });
  return first;
}
