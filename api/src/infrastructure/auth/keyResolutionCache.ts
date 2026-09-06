/**
 * API-key → tenant resolution cache, expressed on the ONE read-through helper.
 *
 * Hit path: L1 (in-isolate) then KV. Miss path: ~30-80ms (Neon round-trip from a
 * Worker). After the first call for any given key, every subsequent call for the
 * next year is a cache hit.
 *
 * Cache key format:  `auth:<keyType>:<sha256(rawKey)>` for `bfk`/`clk`;
 *                    `auth:jwt:<sha256(tenantId:userId)>` for the JWT path.
 * Cached value:      the ResolvedKey envelope — a rejection is cached too, so a
 *                    stranger hammering a dead key costs one DB read, not one per
 *                    request.
 *
 * Two TTL regimes: `bfk`/`clk` keys use the 365-day TTL and rely on explicit
 * `invalidateKeyCache` calls from every auth-affecting mutation. The `jwt`
 * membership path uses a short TTL (`JWT_TTL_SECONDS`) and self-heals — there
 * is no single tenant_members mutation hook, so membership/role/superadmin
 * changes propagate within that window. `invalidateJwtMembershipCache` is an
 * optional fast-path for callers that want instant propagation.
 *
 * **TTL is intentionally long (365 days) because every mutation that
 * affects auth resolution explicitly calls `invalidateKeyCache`** —
 * specifically: revoke, update (origin allowlist / name), agentHost deactivation,
 * agentHost daily-limit change. Mint creates no cache entry to invalidate (the
 * first call populates it). Tenant plan/billing changes invalidate their OWN
 * cache (`application/tenant/tenantPlanCache`) — `resolveTenantPlan` reads that
 * snapshot, outside this block.
 *
 * If you add a new mutation that changes auth resolution, you MUST call
 * `invalidateKeyCache` from that handler — otherwise the change won't take
 * effect for up to a year.
 *
 * This used to be a second, hand-rolled KV cache beside `readThroughCache` — no
 * L1, no rate-limit retry on invalidation, a tombstone protocol of its own. It
 * is now a key scheme over `getOrSetCached` / `invalidateCached`, so the one
 * helper owns every cache: the L1 hit that saves a KV read per request on a hot
 * key, the KV-unbound fallthrough, and the retry that makes an invalidation hold.
 */

import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../cache/readThroughCache';

/** 365 days. Long-lived because mutations invalidate explicitly. */
const TTL_SECONDS = 365 * 24 * 60 * 60;
/**
 * Short TTL for the JWT membership path. Unlike `bfk_*`/`clk_*` keys (whose every
 * auth-affecting mutation calls `invalidateKeyCache`), tenant_members rows are
 * mutated from many scattered sites (TenantRepository.save replace-all,
 * admin role-change / demote / remove). There is no single membership-change
 * hook to invalidate from, so this path self-heals via a short TTL instead:
 * a removed/demoted member keeps cached access for at most this window.
 */
export const JWT_TTL_SECONDS = 60;
/** In-isolate freshness. The JWT path's L1 is shorter than its KV TTL so a
 *  membership change never outlives the self-heal window by an L1 hit. */
const L1_TTL_MS = 30_000;
const JWT_L1_TTL_MS = 15_000;

export type KeyCacheType = 'bfk' | 'clk' | 'jwt';

/** What the loader returns; gateway auth uses this to populate TenantAccess. */
export type ResolvedKey =
  | { ok: true;  payload: Record<string, unknown> }
  | { ok: false; reason: string };

/** The ONE spelling of a key-resolution cache key. */
export function keyCacheKey(keyType: KeyCacheType, hash: string): string {
  return `auth:${keyType}:${hash}`;
}

/**
 * Look up a key, consulting the cache first. `loader` is called on a miss (or
 * when no KV is bound and the L1 has aged out) and its result is cached under
 * the regime for `keyType`.
 */
export async function resolveKeyCached(
  env: Env,
  keyType: KeyCacheType,
  hash: string,
  loader: () => Promise<ResolvedKey>,
): Promise<ResolvedKey> {
  const jwt = keyType === 'jwt';
  return getOrSetCached(env, keyCacheKey(keyType, hash), loader, {
    kvTtlSeconds: jwt ? JWT_TTL_SECONDS : TTL_SECONDS,
    l1TtlMs: jwt ? JWT_L1_TTL_MS : L1_TTL_MS,
  });
}

/**
 * Invalidate a key's cache entry — both layers. Call after revocation so the next
 * request re-loads from the DB (which then sees the `revoked_at` timestamp and
 * caches the correct "rejected" state) instead of honouring a stale "valid"
 * entry for up to TTL_SECONDS.
 */
export async function invalidateKeyCache(env: Env, keyType: KeyCacheType, hash: string): Promise<void> {
  await invalidateCached(env, keyCacheKey(keyType, hash));
}

/**
 * Invalidate an agentHost (`clk_*` / `bfa_*`) key's auth cache entry.
 *
 * AgentHost keys are always cached under the `'clk'` keyType, and every agentHost
 * mutation has the same null-hash guard (a row may carry a NULL `apiKeyHash`).
 * This is the single shared seam so the keyType + guard never drift across the
 * repo/service/route call sites that change an agentHost's auth-affecting state
 * (status, daily limit, deletion). No-ops when the hash is absent.
 */
export async function invalidateAgentHostKeyCache(env: Env, apiKeyHash: string | null | undefined): Promise<void> {
  if (!apiKeyHash) return;
  await invalidateKeyCache(env, 'clk', apiKeyHash);
}

/**
 * Cache key for a JWT membership resolution: `auth:jwt:<sha256(tenantId:userId)>`.
 * Shared seam so the hashing scheme can't drift between the resolver and any
 * future invalidation call site. The cache value is keyed on tenant+user (not
 * the raw token) so every JWT the user holds for that tenant shares one entry.
 */
export function jwtMembershipHash(tenantId: number, userId: string): string {
  return `${tenantId}:${userId}`;
}

/**
 * Invalidate the cached JWT membership resolution for a (tenant, user) pair.
 * The JWT path self-heals via a short TTL, so calling this is an *optional*
 * fast-path: wire it into a membership mutation when you want the change to
 * take effect immediately instead of after `JWT_TTL_SECONDS`. Safe to no-op.
 */
export async function invalidateJwtMembershipCache(env: Env, tenantId: number, userId: string): Promise<void> {
  await invalidateKeyCache(env, 'jwt', jwtMembershipHash(tenantId, userId));
}
