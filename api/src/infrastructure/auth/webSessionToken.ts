import { decodeJwtPayload, signWebJwt } from './JwtService';
import { parseTokenTimeToDate } from './MfaService';
import { authTokens, authUserSessions } from '../database/schema';
import { eq } from 'drizzle-orm';
import type { Db } from '../database/connection';

/**
 * Mint a WEB (tenantless) session JWT for a user and persist its session +
 * token rows so `webAuthMiddleware`'s jti-revocation and session checks accept
 * it — an unpersisted jti is treated as revoked. Companion to
 * {@link ../auth/tenantSessionToken.mintTenantSessionToken} for the web-token
 * shape; used by programmatic sign-ins (demo sessions) that never pass through
 * the password/OAuth login routes.
 */
export async function mintWebSessionToken(
  db: Db,
  jwtSecret: string,
  opts: {
    userId: string;
    email: string;
    username: string;
    sessionName?: string | null;
    userAgent?: string | null;
    ipAddress?: string | null;
    expiresIn?: number;
  },
): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = opts.expiresIn ?? 86_400;
  const token = await signWebJwt(
    { sub: opts.userId, email: opts.email, username: opts.username },
    jwtSecret,
    expiresIn,
  );
  const payload = decodeJwtPayload<{ jti?: string; sid?: string; exp: number }>(token);
  if (!payload.jti) return { token, expiresIn };

  if (payload.sid) {
    const [existing] = await db
      .select({ id: authUserSessions.id })
      .from(authUserSessions)
      .where(eq(authUserSessions.id, payload.sid))
      .limit(1);
    if (!existing) {
      await db.insert(authUserSessions).values({
        id: payload.sid,
        userId: opts.userId,
        sessionName: opts.sessionName ?? null,
        userAgent: opts.userAgent ?? null,
        ipAddress: opts.ipAddress ?? null,
      });
    }
  }

  await db.insert(authTokens).values({
    jti: payload.jti,
    userId: opts.userId,
    sessionId: payload.sid ?? null,
    tenantId: null,
    tokenType: 'web',
    issuedAt: new Date(),
    expiresAt: parseTokenTimeToDate(payload.exp),
    userAgent: opts.userAgent ?? null,
    ipAddress: opts.ipAddress ?? null,
  });

  return { token, expiresIn };
}
