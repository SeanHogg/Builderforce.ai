/**
 * Session directory — the ONE read of "a person's sessions, each with its live-token
 * count". The self-service list (`GET /api/auth/sessions`), the superadmin console
 * and the workspace security page each carried their own copy of the per-session
 * select + `GROUP BY session_id` count, differing only in whether the count is
 * narrowed to one workspace's tokens (`scope.tenantId`). Revocation is the sibling
 * use case in `sessionRevocation.ts`.
 */

import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { authTokens, authUserSessions, users } from '../../infrastructure/database/schema';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';

/** `tenantId` narrows the live-token count to one workspace; omit for the person's whole account. */
export interface SessionScope {
  tenantId?: number;
}

/** Every session of `userId`, most recently seen first, with its count of live tokens. */
export async function listUserSessions(db: Db, userId: string, scope: SessionScope = {}) {
  const sessions = await db
    .select()
    .from(authUserSessions)
    .where(eq(authUserSessions.userId, userId))
    .orderBy(desc(authUserSessions.lastSeenAt));

  const sessionIds = sessions.map((session) => session.id);
  const tokenRows = sessionIds.length
    ? await db
      .select({ sessionId: authTokens.sessionId, activeCount: sql<number>`COUNT(*)` })
      .from(authTokens)
      .where(and(
        eq(authTokens.userId, userId),
        scope.tenantId !== undefined ? eq(authTokens.tenantId, scope.tenantId) : undefined,
        inArray(authTokens.sessionId, sessionIds),
        isNull(authTokens.revokedAt),
        gt(authTokens.expiresAt, new Date()),
      ))
      .groupBy(authTokens.sessionId)
    : [];

  const activeBySession = new Map<string, number>();
  for (const row of tokenRows) {
    if (row.sessionId) activeBySession.set(row.sessionId, Number(row.activeCount));
  }

  return sessions.map((session) => ({
    id: session.id,
    sessionName: session.sessionName,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
    isActive: session.isActive,
    revokedAt: session.revokedAt,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    activeTokens: activeBySession.get(session.id) ?? 0,
  }));
}

/** The member-security detail payload the admin console and workspace security page both serve. */
export async function loadMemberSecurityDetail(db: Db, userId: string, scope: SessionScope = {}) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      mfaEnabled: users.mfaEnabled,
      mfaTempExpiresAt: users.mfaTempExpiresAt,
      mfaEnabledAt: users.mfaEnabledAt,
      mfaRecoveryGeneratedAt: users.mfaRecoveryGeneratedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;

  const sessions = await listUserSessions(db, userId, scope);

  const tokenDetails = await db
    .select({
      jti: authTokens.jti,
      tokenType: authTokens.tokenType,
      tenantId: authTokens.tenantId,
      sessionId: authTokens.sessionId,
      issuedAt: authTokens.issuedAt,
      expiresAt: authTokens.expiresAt,
      revokedAt: authTokens.revokedAt,
      userAgent: authTokens.userAgent,
      ipAddress: authTokens.ipAddress,
      lastSeenAt: authTokens.lastSeenAt,
    })
    .from(authTokens)
    .where(eq(authTokens.userId, userId))
    .orderBy(desc(authTokens.lastSeenAt)).limit(LIST_ROW_CAP);

  const now = new Date();
  return {
    user: { id: user.id, email: user.email, username: user.username, displayName: user.displayName },
    mfa: {
      enabled: user.mfaEnabled,
      setupPending: Boolean(user.mfaTempExpiresAt && user.mfaTempExpiresAt > now),
      enabledAt: user.mfaEnabledAt,
      recoveryGeneratedAt: user.mfaRecoveryGeneratedAt,
    },
    sessions,
    tokens: tokenDetails.map((row) => ({ ...row, isActive: !row.revokedAt && row.expiresAt > now })),
  };
}
