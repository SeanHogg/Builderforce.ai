import { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { UnauthorizedError } from '../../domain/shared/errors';
import { verifyWebJwt } from '../../infrastructure/auth/JwtService';
import { buildDatabase } from '../../infrastructure/database/connection';
import { authTokens, authUserSessions } from '../../infrastructure/database/schema';
import { and, eq, isNull, gt, sql } from 'drizzle-orm';
import { checkTermsAcceptance } from './termsEnforcement';

/**
 * Web/marketplace JWT middleware.
 *
 * Reads `Authorization: Bearer <webToken>`, verifies the HS256 signature,
 * and injects only `userId` into the Hono context.
 *
 * Unlike `authMiddleware`, this does NOT require a tenantId / role claim –
 * web tokens are issued during email+password registration/login.
 */
export const webAuthMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);
  let payload;
  try {
    payload = await verifyWebJwt(token, c.env.JWT_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }

  if (payload.jti) {
    const db = buildDatabase(c.env);
    const [activeToken] = await db
      .select({
        jti: authTokens.jti,
        sessionId: authTokens.sessionId,
      })
      .from(authTokens)
      .where(
        and(
          eq(authTokens.jti, payload.jti),
          eq(authTokens.userId, payload.sub),
          isNull(authTokens.revokedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!activeToken) {
      throw new UnauthorizedError('Token has been revoked or expired');
    }

    if (activeToken.sessionId) {
      const [session] = await db
        .select({ id: authUserSessions.id })
        .from(authUserSessions)
        .where(
          and(
            eq(authUserSessions.id, activeToken.sessionId),
            eq(authUserSessions.userId, payload.sub),
            eq(authUserSessions.isActive, true),
            isNull(authUserSessions.revokedAt),
          ),
        )
        .limit(1);

      if (!session) {
        throw new UnauthorizedError('Session has been revoked');
      }

      await db
        .update(authUserSessions)
        .set({ lastSeenAt: sql`now()` })
        .where(eq(authUserSessions.id, activeToken.sessionId));
    }

    await db
      .update(authTokens)
      .set({ lastSeenAt: sql`now()` })
      .where(eq(authTokens.jti, payload.jti));

    c.set('tokenJti', payload.jti);
  }

  if (!c.req.path.startsWith('/api/auth/legal')) {
    const db = buildDatabase(c.env);
    const terms = await checkTermsAcceptance(db, payload.sub);
    if (terms.needsAcceptance) {
      return c.json({
        error: 'Terms acceptance required',
        code: 'TERMS_ACCEPTANCE_REQUIRED',
        requiredVersion: terms.requiredVersion,
        acceptedVersion: terms.acceptedVersion,
      }, 428);
    }
  }

  c.set('userId', payload.sub);
  if (payload.sid) c.set('sessionId', payload.sid);
  await next();
};
