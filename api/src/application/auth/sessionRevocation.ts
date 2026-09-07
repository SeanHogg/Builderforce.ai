/**
 * Token + session revocation — the ONE implementation of "is this jti still
 * live, and is its session still active?".
 *
 * `authMiddleware` (tenant JWT) and `webAuthMiddleware` (web JWT) both need this
 * exact check on every request, and both used to carry their own copy: two
 * sequential selects followed by two unconditional `last_seen_at` UPDATEs. The
 * copies had already drifted (only one of them checked `users.session_version`),
 * and the unconditional writes made every authenticated GET a write transaction.
 *
 * This module owns the query, the assertion, and the write-throttling policy, so
 * a change to any of the three lands in both middlewares at once.
 *
 * Deliberately Hono-free: it takes a `Db` and returns data plus a list of pending
 * writes, leaving the caller to decide how to run them (the middlewares hand them
 * to `executionCtx.waitUntil`).
 *
 * It also owns the WRITE side — {@link revokeSessionTokens}. Eleven route
 * handlers across `authRoutes`, `adminRoutes` and `tenantRoutes` each carried
 * their own pair of `UPDATE auth_user_sessions` / `UPDATE auth_tokens`
 * statements, and none of them told the legacy worker: it caches this module's
 * verdict (via `GET /api/auth/introspect`) in the shared `AUTH_CACHE_KV`, so a
 * revoke that only touched the database left the worker accepting the token
 * until the cache expired. One use case, one invalidation, every site.
 */

import { and, eq, gt, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { sessionIntrospectCacheKey } from '@builderforce/session-introspection';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authTokens, authUserSessions } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { UnauthorizedError } from '../../domain/shared/errors';

/**
 * How stale a `last_seen_at` may get before it is written again.
 *
 * These columns drive the "active sessions" list and last-seen chips, where a
 * minute of lag is invisible. Writing them on every request turned each
 * authenticated GET into two write round-trips against neon-http — the largest
 * single latency contributor on this path, and a standing Neon-compute cost item.
 */
export const LAST_SEEN_THROTTLE_MS = 60_000;

export interface ActiveTokenRow {
  jti: string;
  /** The session this token was minted under, if any (null for session-less tokens). */
  sessionId: string | null;
  /** The joined live session row's id — null when the session is revoked/inactive. */
  sessionRowId: string | null;
  tokenLastSeenAt: Date | null;
  sessionLastSeenAt: Date | null;
}

/**
 * Read the token row and its session in ONE round-trip.
 *
 * The join is a LEFT JOIN on purpose: a token with no `sessionId` is legitimate,
 * and an INNER JOIN would make it indistinguishable from a revoked session. The
 * caller separates the two cases via {@link assertActiveToken}.
 */
export async function findActiveToken(db: Db, userId: string, jti: string): Promise<ActiveTokenRow | null> {
  const [row] = await db
    .select({
      jti: authTokens.jti,
      sessionId: authTokens.sessionId,
      tokenLastSeenAt: authTokens.lastSeenAt,
      sessionRowId: authUserSessions.id,
      sessionLastSeenAt: authUserSessions.lastSeenAt,
    })
    .from(authTokens)
    .leftJoin(
      authUserSessions,
      and(
        eq(authUserSessions.id, authTokens.sessionId),
        eq(authUserSessions.userId, userId),
        eq(authUserSessions.isActive, true),
        isNull(authUserSessions.revokedAt),
      ),
    )
    .where(
      // `session_credential`: the row IS the presented token. `jti` names one row
      // and `user_id` names its holder — both stronger than a tenant filter, and
      // the token's own nullable `tenant_id` describes it rather than gating it.
      acrossTenants(
        authTokens,
        'session_credential',
        eq(authTokens.jti, jti),
        eq(authTokens.userId, userId),
        isNull(authTokens.revokedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Turn the row from {@link findActiveToken} into a guaranteed-live token, or
 * throw the same `401` both middlewares used to raise independently.
 */
export function assertActiveToken(row: ActiveTokenRow | null): ActiveTokenRow {
  if (!row) throw new UnauthorizedError('Token has been revoked or expired');
  // The token names a session but the LEFT JOIN matched no live row for it →
  // that session was revoked or deactivated.
  if (row.sessionId && !row.sessionRowId) {
    throw new UnauthorizedError('Session has been revoked');
  }
  return row;
}

/**
 * The `last_seen_at` refreshes that are actually due for this token, as unawaited
 * promises. Returns an empty array when both values are inside the throttle
 * window — which is the common case, so the common case costs zero writes.
 *
 * Run these OFF the critical path (`executionCtx.waitUntil`): nothing in the
 * response depends on them.
 */
export function lastSeenWrites(db: Db, row: ActiveTokenRow, now = Date.now()): Promise<unknown>[] {
  const stale = (at: Date | null) => !at || now - at.getTime() > LAST_SEEN_THROTTLE_MS;
  const writes: Promise<unknown>[] = [];

  if (stale(row.tokenLastSeenAt)) {
    // `session_credential`: `row` came from {@link findActiveToken}, so the jti is
    // the one this request presented — one row, already authenticated.
    writes.push(db.update(authTokens).set({ lastSeenAt: sql`now()` })
      .where(acrossTenants(authTokens, 'session_credential', eq(authTokens.jti, row.jti))));
  }
  if (row.sessionRowId && stale(row.sessionLastSeenAt)) {
    writes.push(
      db.update(authUserSessions).set({ lastSeenAt: sql`now()` }).where(eq(authUserSessions.id, row.sessionRowId)),
    );
  }
  return writes;
}

/**
 * Which tokens (and sessions) a revoke names.
 *
 *   - `{ userId, sessionId }`       one session and every token minted under it;
 *   - `{ userId, exceptSessionId }` every OTHER active session of the user —
 *                                   "sign out everywhere else";
 *   - `{ userId, jti }`             one token; its session survives;
 *   - `{ userId }`                  every active session and token — force-logout;
 *   - `{ jti }`                     one token by id regardless of holder — an
 *                                   emulation token ending an impersonation.
 *
 * `tenantId` narrows the TOKEN update to one workspace's tokens (the admin and
 * tenant-manager routes act on a member within a tenant, never across tenants);
 * sessions are user-level and never tenant-scoped.
 */
export type RevokeSelector =
  | { userId: string; sessionId: string; tenantId?: number }
  | { userId: string; exceptSessionId: string }
  | { userId: string; jti: string; tenantId?: number }
  | { userId: string; tenantId?: number }
  | { jti: string };

/** The `auth_user_sessions` rows a selector deactivates — none for a single token. */
function sessionPredicate(selector: RevokeSelector): SQL | undefined {
  if ('jti' in selector) return undefined;
  if ('sessionId' in selector) {
    return and(eq(authUserSessions.id, selector.sessionId), eq(authUserSessions.userId, selector.userId));
  }
  if ('exceptSessionId' in selector) {
    return and(
      eq(authUserSessions.userId, selector.userId),
      ne(authUserSessions.id, selector.exceptSessionId),
      eq(authUserSessions.isActive, true),
    );
  }
  return and(eq(authUserSessions.userId, selector.userId), eq(authUserSessions.isActive, true));
}

/**
 * The live `auth_tokens` rows a selector revokes.
 *
 * Returned as CLAUSES rather than a finished predicate so the statement that runs
 * them states its own scope — `acrossTenants(authTokens, 'session_credential', …)`
 * at the call site, where a reader and `check-tenant-scope` both see it.
 *
 * Declared `session_credential` (see tenantScope.ts): a person holds ONE session
 * across every workspace they belong to, so a revoke that stopped at one tenant
 * would report success and leave live tokens behind. `tenantId` on the selector
 * NARROWS to one workspace's tokens where the calling route means to; it is not
 * the gate. The gate is the server-established `userId`/`jti` every branch adds.
 */
function tokenClauses(selector: RevokeSelector): SQL[] {
  const clauses: SQL[] = [isNull(authTokens.revokedAt)];
  if ('userId' in selector) clauses.push(eq(authTokens.userId, selector.userId));
  if ('tenantId' in selector && selector.tenantId !== undefined) clauses.push(eq(authTokens.tenantId, selector.tenantId));
  if ('sessionId' in selector) clauses.push(eq(authTokens.sessionId, selector.sessionId));
  // `ne` on a NULL session_id is NULL, so session-less tokens are deliberately
  // NOT swept by "sign out everywhere else" — they were never part of a session.
  if ('exceptSessionId' in selector) clauses.push(ne(authTokens.sessionId, selector.exceptSessionId));
  if ('jti' in selector) clauses.push(eq(authTokens.jti, selector.jti));
  return clauses;
}

/**
 * Revoke the sessions and tokens `selector` names, then drop each revoked jti's
 * cached introspection verdict from the shared KV so the legacy worker stops
 * honouring it within its L1 TTL rather than at `exp`.
 *
 * ONE statement per table. The token update `RETURNING jti` is what makes the
 * invalidation exact: the cache key is per-jti, and enumerating the rows the
 * database actually flipped is the only way to know which keys exist.
 */
export async function revokeSessionTokens(
  db: Db,
  env: Env | undefined,
  selector: RevokeSelector,
): Promise<{ revokedJtis: string[] }> {
  const sessions = sessionPredicate(selector);
  if (sessions) {
    await db
      .update(authUserSessions)
      .set({ isActive: false, revokedAt: sql`now()`, lastSeenAt: sql`now()` })
      .where(sessions);
  }

  const rows = await db
    .update(authTokens)
    .set({ revokedAt: sql`now()`, lastSeenAt: sql`now()` })
    // See {@link tokenClauses} for why the credential tables are not tenant-filtered.
    .where(acrossTenants(authTokens, 'session_credential', ...tokenClauses(selector)))
    .returning({ jti: authTokens.jti });

  const revokedJtis = rows.map((row) => row.jti);
  await Promise.all(revokedJtis.map((jti) => invalidateCached(env, sessionIntrospectCacheKey(jti))));
  return { revokedJtis };
}
