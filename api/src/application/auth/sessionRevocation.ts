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
 */

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { authTokens, authUserSessions } from '../../infrastructure/database/schema';
import { UnauthorizedError, type AuthErrorCode } from '../../domain/shared/errors';

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
      and(
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
    writes.push(db.update(authTokens).set({ lastSeenAt: sql`now()` }).where(eq(authTokens.jti, row.jti)));
  }
  if (row.sessionRowId && stale(row.sessionLastSeenAt)) {
    writes.push(
      db.update(authUserSessions).set({ lastSeenAt: sql`now()` }).where(eq(authUserSessions.id, row.sessionRowId)),
    );
  }
  return writes;
}
