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
import { authTokens, authUserSessions, users } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { UnauthorizedError } from '../../domain/shared/errors';

/**
 * How stale a `last_seen_at` may get before it is written again.
 *
 * These columns only order the "active sessions" lists (auth, admin and tenant
 * routes); nothing compares them to a threshold. Writing them on every request
 * turned each authenticated GET into two write round-trips against neon-http. A
 * one-minute throttle still meant ~1,440 writes per token per day from an always-on
 * VS Code extension or on-prem runtime (auth_tokens: 331k writes on 3.6k rows,
 * 2026-09-14), which alone keeps Neon compute from suspending. Fifteen minutes is
 * invisible in a list sorted by recency.
 */
export const LAST_SEEN_THROTTLE_MS = 15 * 60_000;

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
 * THE CACHED VERDICT — why an authenticated request does not have to wake Postgres.
 *
 * {@link findActiveToken} ran on EVERY authenticated request, so an open VS Code
 * window (polling every 30–60s) kept the core database awake all day on its own —
 * at Neon's 0.25 CU floor that is the difference between fitting the Free plan and
 * not (ROADMAP, 2026-09-15). A LIVE token's row is therefore cached under its jti,
 * and {@link revokeSessionTokens} — the one writer that can make it not-live —
 * deletes that key in the same call that flips the row.
 *
 * Only a live verdict is cached. A miss (unknown, revoked, expired, dead session)
 * always reads the database, so nothing is ever held "rejected" and a token minted a
 * moment ago is never refused from cache.
 *
 * The cost is revocation latency, and it is bounded: the KV delete is global, but an
 * isolate that already holds the verdict in L1 keeps honouring it for up to
 * {@link ACTIVE_TOKEN_CACHE}.l1TtlMs, and KV itself propagates a delete to other
 * locations within about a minute. `users.session_version` (force-logout) is checked
 * separately and has the same bound. Signature and `exp` are still verified on every
 * request, so an expired token is refused regardless of this cache.
 */
export const activeTokenCacheKey = (jti: string): string => `auth:active:${jti}`;

const ACTIVE_TOKEN_CACHE = { kvTtlSeconds: 5 * 60, l1TtlMs: 30_000 };

/** {@link ActiveTokenRow} as it survives JSON: KV would hand `Date`s back as strings. */
interface CachedActiveToken {
  /** The holder, checked on read — a jti is only ever honoured for the user it names. */
  userId: string;
  jti: string;
  sessionId: string | null;
  sessionRowId: string | null;
  tokenLastSeenAt: number | null;
  sessionLastSeenAt: number | null;
}

function toCached(userId: string, row: ActiveTokenRow): CachedActiveToken {
  return {
    userId,
    jti: row.jti,
    sessionId: row.sessionId,
    sessionRowId: row.sessionRowId,
    tokenLastSeenAt: row.tokenLastSeenAt ? new Date(row.tokenLastSeenAt).getTime() : null,
    sessionLastSeenAt: row.sessionLastSeenAt ? new Date(row.sessionLastSeenAt).getTime() : null,
  };
}

function fromCached(cached: CachedActiveToken): ActiveTokenRow {
  return {
    jti: cached.jti,
    sessionId: cached.sessionId,
    sessionRowId: cached.sessionRowId,
    tokenLastSeenAt: cached.tokenLastSeenAt == null ? null : new Date(cached.tokenLastSeenAt),
    sessionLastSeenAt: cached.sessionLastSeenAt == null ? null : new Date(cached.sessionLastSeenAt),
  };
}

/** {@link findActiveToken} through the cache — a live verdict is served from KV/L1. */
export async function findActiveTokenCached(
  env: Env | undefined,
  db: Db,
  userId: string,
  jti: string,
): Promise<ActiveTokenRow | null> {
  const key = activeTokenCacheKey(jti);
  const hit = await peekCached<CachedActiveToken>(env, key);
  if (hit && hit.userId === userId) return fromCached(hit);

  const row = await findActiveToken(db, userId, jti);
  const live = row != null && !(row.sessionId && !row.sessionRowId);
  if (live) await setCached(env, key, toCached(userId, row), ACTIVE_TOKEN_CACHE);
  return row;
}

/**
 * THE per-request token check both middlewares run: the cached verdict, asserted
 * live, plus the `last_seen_at` writes that are due (run them off the critical path).
 *
 * When writes are due, the cached copy is refreshed with the new timestamps in the
 * same batch — the throttle compares against the CACHED values, so without that every
 * request after the window would re-issue both writes.
 */
export async function resolveActiveToken(
  env: Env | undefined,
  db: Db,
  userId: string,
  jti: string,
): Promise<{ active: ActiveTokenRow; writes: Promise<unknown>[] }> {
  const active = assertActiveToken(await findActiveTokenCached(env, db, userId, jti));
  const now = Date.now();
  const writes = lastSeenWrites(db, active, now);
  if (writes.length > 0) {
    const touched = { ...active, tokenLastSeenAt: new Date(now), sessionLastSeenAt: active.sessionRowId ? new Date(now) : null };
    writes.push(setCached(env, activeTokenCacheKey(jti), toCached(userId, touched), ACTIVE_TOKEN_CACHE));
  }
  return { active, writes };
}

/**
 * `users.session_version` through the cache — the force-logout counter `authMiddleware`
 * compares a token's `sv` claim against on every request, which was the SECOND
 * uncached read each authenticated request made. Its one writer is the admin
 * force-logout route, which calls {@link invalidateSessionVersion} in the same request
 * as the increment; the lag bound is the one {@link activeTokenCacheKey} documents.
 */
export const sessionVersionCacheKey = (userId: string): string => `auth:session-version:${userId}`;

export async function sessionVersionOf(env: Env | undefined, db: Db, userId: string): Promise<number | null> {
  return getOrSetCached(env, sessionVersionCacheKey(userId), async () => {
    const [row] = await db
      .select({ sessionVersion: users.sessionVersion })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ? row.sessionVersion : null;
  }, ACTIVE_TOKEN_CACHE);
}

export async function invalidateSessionVersion(env: Env | undefined, userId: string): Promise<void> {
  await invalidateCached(env, sessionVersionCacheKey(userId));
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
  // Both cached verdicts for each revoked jti: the worker's introspection answer and
  // this API's own live-token row ({@link findActiveTokenCached}).
  await Promise.all(revokedJtis.flatMap((jti) => [
    invalidateCached(env, sessionIntrospectCacheKey(jti)),
    invalidateCached(env, activeTokenCacheKey(jti)),
  ]));
  return { revokedJtis };
}
