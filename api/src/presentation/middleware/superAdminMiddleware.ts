import { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import type { HonoEnv } from '../../env';
import { verifyWebJwt } from '../../infrastructure/auth/JwtService';
import { UnauthorizedError, ForbiddenError } from '../../domain/shared/errors';
import { buildDatabase } from '../../infrastructure/database/connection';
import { users } from '../../infrastructure/database/schema';
import { checkTermsAcceptance } from './termsEnforcement';

/**
 * Middleware that gates access to superadmin-only endpoints.
 *
 * Expects a WebJWT (24-hour session token) with `sa: true` claim AND the
 * corresponding user row having `isSuperadmin = true` in the database.
 * Both checks are required — the JWT claim alone is not sufficient.
 *
 * Emulation tokens (emu: true) are explicitly rejected so that an active
 * impersonation session can never be used to call admin routes.
 *
 * Sets `userId` in the Hono context for downstream use.
 */
export const superAdminMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
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

  // Reject emulation tokens — impersonation must never grant admin access
  if ((payload as unknown as Record<string, unknown>).emu === true) {
    throw new ForbiddenError('Emulation tokens cannot be used for superadmin routes');
  }

  if (!payload.sa) {
    throw new ForbiddenError('Superadmin access required');
  }

  // Verify the DB flag — the JWT claim alone is not sufficient
  const db = buildDatabase(c.env);
  const [userRow] = await db
    .select({ isSuperadmin: users.isSuperadmin })
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1);

  if (!userRow?.isSuperadmin) {
    throw new ForbiddenError('Superadmin access is restricted to platform operator accounts');
  }

  const terms = await checkTermsAcceptance(db, payload.sub);
  if (terms.needsAcceptance) {
    return c.json({
      error: 'Terms acceptance required',
      code: 'TERMS_ACCEPTANCE_REQUIRED',
      requiredVersion: terms.requiredVersion,
      acceptedVersion: terms.acceptedVersion,
    }, 428);
  }

  c.set('userId', payload.sub);
  await next();
};
