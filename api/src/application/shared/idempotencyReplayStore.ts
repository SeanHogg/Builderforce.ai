/**
 * The {@link IdempotencyStore} adapter over the API's canonical read-through cache
 * (L1 in-isolate + L2 Workers KV, `AUTH_CACHE_KV`). KV is the cross-isolate source of
 * truth and expires each record after {@link IDEMPOTENCY_TTL_SECONDS}; with KV unbound
 * (tests, local dev) only the short-lived L1 copy exists.
 */

import {
  IDEMPOTENCY_TTL_SECONDS,
  type IdempotencyStore,
  type StoredIdempotentResponse,
} from './idempotentReplay';
import { peekCached, setCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';

/** Tenant-scoped, so one tenant's key can never answer another tenant's request. */
export function idempotencyReplayCacheKey(tenantId: number, key: string): string {
  return `idem-replay:t:${tenantId}:${key}`;
}

export function createCacheIdempotencyStore(env: CacheEnv): IdempotencyStore {
  return {
    get: (tenantId, key) => peekCached<StoredIdempotentResponse>(env, idempotencyReplayCacheKey(tenantId, key)),
    put: (tenantId, key, response) =>
      setCached(env, idempotencyReplayCacheKey(tenantId, key), response, { kvTtlSeconds: IDEMPOTENCY_TTL_SECONDS }),
  };
}
