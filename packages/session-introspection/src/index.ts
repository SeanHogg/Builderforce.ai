/**
 * Session introspection — the contract the API serves and the legacy worker calls.
 *
 * The worker verifies the API's session token by signature and `exp` alone
 * (`@builderforce/hs256-jwt`), so a token the API had REVOKED — a signed-out
 * session, a force-logout, an admin revoke — kept opening the worker's data routes
 * until it expired. The worker has no database and no session store; what it can
 * do is ask the API, and remember the answer.
 *
 * Both ends of that call import this module:
 *   - the API mounts {@link SESSION_INTROSPECT_PATH} behind its own auth
 *     middleware, so the verdict IS the middleware's verdict;
 *   - the worker caches the verdict under {@link sessionIntrospectCacheKey} in the
 *     API's own KV namespace (`AUTH_CACHE_KV`, bound in both wrangler.toml files);
 *   - the API's ONE revoke use case (`sessionRevocation.revokeSessionTokens`)
 *     invalidates that same key, so a revoked session stops at the worker within
 *     the worker's L1 TTL instead of at the token's `exp`.
 *
 * One key format, spelled once, or the invalidation and the read drift apart.
 */

export const SESSION_INTROSPECT_PATH = '/api/auth/introspect';

/** Cache key for a token's introspection verdict. Keyed on `jti`, not the token
 *  text: a jti is what a revoke names, and it keeps the bearer out of KV. */
export function sessionIntrospectCacheKey(jti: string): string {
  return `auth:introspect:${jti}`;
}

/**
 * KV holds the verdict for 60s (the KV floor); the worker's L1 holds it for 30s.
 * The revoke path deletes the KV key immediately, so the L1 TTL is the longest a
 * revoked token can still pass the worker — the same order of time the API's own
 * `last_seen_at` throttle already tolerates.
 */
export const SESSION_INTROSPECT_CACHE_TTL = { kvTtlSeconds: 60, l1TtlMs: 30_000 } as const;

export type SessionIntrospection =
  | { active: true; sub: string; tenantId: number | null; jti: string; exp: number }
  | { active: false; reason: 'revoked' | 'expired' | 'unknown' };
