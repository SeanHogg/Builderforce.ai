import type { IdempotencyStore, StoredIdempotentResponse } from '../../application/shared/idempotentReplay';
import { peekCached, setCached, type CacheEnv } from './readThroughCache';

/**
 * The {@link IdempotencyStore} adapter over the API's canonical read-through cache
 * (L1 in-isolate + L2 Workers KV, `AUTH_CACHE_KV`) — the sibling of
 * `./reasoningReplayStore.ts`. KV is the cross-isolate source of truth and expires
 * each record after `ttlSeconds`; with KV unbound (tests, local dev) only the
 * short-lived L1 copy exists.
 *
 * The TTL is the policy's (`IDEMPOTENCY_TTL_SECONDS`), passed in by the application
 * factory so this adapter holds no policy of its own.
 */

/** Tenant-scoped, so one tenant's key can never answer another tenant's request. */
export function idempotencyReplayCacheKey(tenantId: number, key: string): string {
  return `idem-replay:t:${tenantId}:${key}`;
}

export function cacheIdempotencyStore(env: CacheEnv, ttlSeconds: number): IdempotencyStore {
  return {
    get: (tenantId, key) => peekCached<StoredIdempotentResponse>(env, idempotencyReplayCacheKey(tenantId, key)),
    put: (tenantId, key, response) =>
      setCached(env, idempotencyReplayCacheKey(tenantId, key), response, { kvTtlSeconds: ttlSeconds }),
  };
}
