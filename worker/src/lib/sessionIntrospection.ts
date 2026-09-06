/**
 * "Is this session token still live?" — asked of the api, remembered in the
 * api's own cache namespace.
 *
 * The worker verifies the api's session token by signature and `exp`
 * (`lib/auth.ts`), but it has no session store, so a token the api has REVOKED
 * — sign-out, force-logout, an admin revoke — was accepted here until it expired.
 * The api already answers that question on every request of its own
 * (`sessionRevocation.findActiveToken`); `GET /api/auth/introspect` exposes the
 * verdict, and this module asks for it once per jti and caches it.
 *
 * The cache is the SAME KV namespace the api uses (`AUTH_CACHE_KV`, bound in
 * both wrangler.toml files) through the SAME read-through cache primitive, so
 * the api's ONE revoke use case (`revokeSessionTokens`) deletes exactly the key
 * this module reads. A revoked session therefore stops here within the L1 TTL
 * (30s) rather than at `exp`.
 *
 * Verdict handling, and why each case is what it is:
 *   - 200            → the api's own middleware admitted the token: cache `active`;
 *   - 401 / 403      → the api refused it: cache `{ active: false }` — a revoked
 *                      token stays revoked, so caching the refusal is safe and
 *                      spares the api a request per retry;
 *   - anything else  → THROW, and never cache: the api is down or misconfigured,
 *                      and the caller must fail closed (503), not open.
 */
import { createReadThroughCache, type KvNamespaceLike } from '@builderforce/read-through-cache';
import {
  SESSION_INTROSPECT_CACHE_TTL,
  SESSION_INTROSPECT_PATH,
  sessionIntrospectCacheKey,
  type SessionIntrospection,
} from '@builderforce/session-introspection';
import { getApiBaseUrl, type ApiBaseEnv } from './apiBaseUrl';

export interface SessionIntrospectionEnv extends ApiBaseEnv {
  /** The api's cache namespace — see wrangler.toml for why it is bound here. */
  AUTH_CACHE_KV?: KvNamespaceLike;
}

/** ONE instance = ONE L1 Map for the isolate. The worker has no error reporter
 *  of its own beyond the console, which is where its other failures go too. */
const cache = createReadThroughCache({
  onError: (error, ctx) => {
    console.error('[worker:session-introspection] cache failure', { ...ctx, error: error instanceof Error ? error.message : String(error) });
  },
});

/** Thrown when the api cannot answer — never cached. */
export class SessionIntrospectionUnavailableError extends Error {
  constructor(detail: string) {
    super(`Session introspection unavailable: ${detail}`);
    this.name = 'SessionIntrospectionUnavailableError';
  }
}

async function fetchVerdict(env: SessionIntrospectionEnv, token: string, fetchImpl: typeof fetch): Promise<SessionIntrospection> {
  let response: Response;
  try {
    response = await fetchImpl(`${getApiBaseUrl(env)}${SESSION_INTROSPECT_PATH}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new SessionIntrospectionUnavailableError(error instanceof Error ? error.message : String(error));
  }

  if (response.status === 401 || response.status === 403) {
    return { active: false, reason: 'revoked' };
  }
  if (response.status !== 200) {
    throw new SessionIntrospectionUnavailableError(`api answered ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SessionIntrospectionUnavailableError('api answered 200 with a body that is not JSON');
  }
  if (!isActiveVerdict(body)) {
    throw new SessionIntrospectionUnavailableError('api answered 200 with an unrecognised verdict');
  }
  return body;
}

function isActiveVerdict(value: unknown): value is Extract<SessionIntrospection, { active: true }> {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.active === true &&
    typeof v.sub === 'string' &&
    (typeof v.tenantId === 'number' || v.tenantId === null) &&
    typeof v.jti === 'string' &&
    typeof v.exp === 'number'
  );
}

/**
 * The cached verdict for `jti`, loading it from the api on a miss.
 *
 * Throws {@link SessionIntrospectionUnavailableError} when the api cannot be
 * reached or answers anything but 200/401/403; that outcome is never cached.
 */
export async function introspectSession(
  env: SessionIntrospectionEnv,
  token: string,
  jti: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionIntrospection> {
  return cache.getOrSet(
    env.AUTH_CACHE_KV,
    sessionIntrospectCacheKey(jti),
    () => fetchVerdict(env, token, fetchImpl),
    SESSION_INTROSPECT_CACHE_TTL,
  );
}

/** TEST-ONLY: reset the per-isolate L1 so tests are order-independent. */
export function __clearSessionIntrospectionCacheForTests(): void {
  cache.clearL1();
}
