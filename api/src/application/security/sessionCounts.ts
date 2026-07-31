import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { authTokens, authUserSessions } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Count each user's ACTIVE sessions and live (non-revoked, unexpired) tokens in
 * two grouped scans. Shared by the admin and tenant `/security/users` endpoints
 * so the "active sessions / active tokens" columns are defined once. Empty
 * `userIds` short-circuits to empty maps (no query).
 */
export async function countActiveSessionsAndTokens(
  db: Db,
  userIds: string[],
): Promise<{ sessionsByUser: Map<string, number>; tokensByUser: Map<string, number> }> {
  const sessionCounts = userIds.length
    ? await db
      .select({ userId: authUserSessions.userId, count: sql<number>`COUNT(*)` })
      .from(authUserSessions)
      .where(and(inArray(authUserSessions.userId, userIds), eq(authUserSessions.isActive, true)))
      .groupBy(authUserSessions.userId)
    : [];

  const tokenCounts = userIds.length
    ? await db
      .select({ userId: authTokens.userId, count: sql<number>`COUNT(*)` })
      .from(authTokens)
      .where(
        and(
          inArray(authTokens.userId, userIds),
          isNull(authTokens.revokedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .groupBy(authTokens.userId)
    : [];

  const sessionsByUser = new Map<string, number>();
  for (const row of sessionCounts) sessionsByUser.set(row.userId, Number(row.count));

  const tokensByUser = new Map<string, number>();
  for (const row of tokenCounts) tokensByUser.set(row.userId, Number(row.count));

  return { sessionsByUser, tokensByUser };
}
