import { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import { UnauthorizedError, ForbiddenError } from '../../domain/shared/errors';
import { verifyJwt } from '../../infrastructure/auth/JwtService';
import { buildDatabase } from '../../infrastructure/database/connection';
import { authTokens, authUserSessions } from '../../infrastructure/database/schema';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { checkTermsAcceptance } from './termsEnforcement';

/**
 * JWT authentication middleware.
 *
 * Reads `Authorization: Bearer <token>`, verifies it, and injects
 * `userId`, `tenantId`, and `role` into Hono context variables.
 *
 * Apply to any route that requires a logged-in user.
 */
export const authMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);
  let payload;
  try {
    payload = await verifyJwt(token, c.env.JWT_SECRET);
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

  if (payload.tid == null) {
    throw new UnauthorizedError('This endpoint requires a workspace token; please select a workspace first');
  }

  if (!payload.sub.startsWith('claw:')) {
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

  c.set('userId',   payload.sub);
  c.set('tenantId', payload.tid);
  c.set('role',     payload.role);
  if (payload.sid) c.set('sessionId', payload.sid);

  await next();
};

/**
 * Role-gating middleware factory.
 *
 * Usage:
 *   router.delete('/:id', authMiddleware, requireRole(TenantRole.MANAGER), handler)
 */
export function requireRole(minimum: TenantRole): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const role = c.get('role') as TenantRole;
    if (!hasMinRole(role, minimum)) {
      throw new ForbiddenError(
        `Requires at least '${minimum}' role, caller has '${role}'`,
      );
    }
    await next();
  };
}
