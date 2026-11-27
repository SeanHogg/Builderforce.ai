/**
 * The token ledger as web renewal reads and writes it — rotation, not revocation.
 *
 * A web renewal replaces the presented token with a successor and marks the old row
 * `superseded_by` that successor. That marker is what separates a token that was
 * ROTATED (presenting it again is either a duplicate of the same renewal or a copy
 * of the token being replayed) from one that was revoked any other way.
 *
 * Kept apart from `sessionRevocation.ts`, which owns "is this token live" for every
 * request; this module owns only the renewal's view of a token's history. Both drop
 * cached verdicts through the one {@link dropCachedTokenVerdicts}.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authTokens, authUserSessions } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { dropCachedTokenVerdicts } from './sessionRevocation';

/** A token row as renewal needs it — whatever its state, unlike `findActiveToken`. */
export interface RenewalTokenRow {
  jti: string;
  sessionId: string | null;
  /** Only `web` rows are renewable; workspace, API and host tokens are minted their own way. */
  tokenType: string;
  /** The token's session exists and is active (always true for a session-less token). */
  sessionLive: boolean;
  issuedAt: Date;
  revokedAt: Date | null;
  /** The jti that replaced this one through a renewal; null for any other revocation. */
  supersededBy: string | null;
}

/**
 * Read one token row and whether its session is live, in ONE round-trip. Ignores
 * `expires_at` and `revoked_at` on purpose: renewal decides from the whole history.
 */
export async function findTokenForRenewal(db: Db, userId: string, jti: string): Promise<RenewalTokenRow | null> {
  const [row] = await db
    .select({
      jti: authTokens.jti,
      sessionId: authTokens.sessionId,
      tokenType: authTokens.tokenType,
      sessionRowId: authUserSessions.id,
      issuedAt: authTokens.issuedAt,
      revokedAt: authTokens.revokedAt,
      supersededBy: authTokens.supersededBy,
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
    // `session_credential`: the jti names the presented token's own row and `user_id` its holder.
    .where(acrossTenants(authTokens, 'session_credential', eq(authTokens.jti, jti), eq(authTokens.userId, userId)))
    .limit(1);
  if (!row) return null;
  return {
    jti: row.jti,
    sessionId: row.sessionId,
    tokenType: row.tokenType,
    sessionLive: !row.sessionId || !!row.sessionRowId,
    issuedAt: row.issuedAt,
    revokedAt: row.revokedAt,
    supersededBy: row.supersededBy,
  };
}

/**
 * Mark `jti` superseded by `successorJti` — a compare-and-set: it only flips a row
 * that is still unrevoked, so of two renewals racing on one token exactly one wins.
 * Returns whether this call won. `expires_at` moves to now so the expired-credential
 * sweep collects the row on its usual grace rather than at the session's end.
 */
export async function supersedeToken(
  db: Db,
  env: Env | undefined,
  rotation: { userId: string; jti: string; successorJti: string },
): Promise<boolean> {
  const rows = await db
    .update(authTokens)
    .set({ revokedAt: sql`now()`, supersededBy: rotation.successorJti, expiresAt: sql`now()`, lastSeenAt: sql`now()` })
    .where(acrossTenants(
      authTokens,
      'session_credential',
      eq(authTokens.jti, rotation.jti),
      eq(authTokens.userId, rotation.userId),
      isNull(authTokens.revokedAt),
    ))
    .returning({ jti: authTokens.jti });
  if (rows.length === 0) return false;
  await dropCachedTokenVerdicts(env, [rotation.jti]);
  return true;
}
