import { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { verifyWebJwt } from '../../infrastructure/auth/JwtService';
import { UnauthorizedError, ForbiddenError } from '../../domain/shared/errors';
import { buildDatabase } from '../../infrastructure/database/connection';
import { resolveIsSuperadmin } from '../../infrastructure/auth/superadminFlag';
import { checkTermsAcceptance } from '../../application/legal/termsAcceptance';

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

  // Verify the DB flag — the JWT claim alone is not sufficient. Served by the ONE
  // cached superadmin resolver (0 Neon round trips warm); a demotion propagates
  // within its short TTL, or immediately via `invalidateSuperadminFlag`.
  const isSuperadmin = await resolveIsSuperadmin(c.env, payload.sub);
  if (!isSuperadmin) {
    throw new ForbiddenError('Superadmin access is restricted to platform operator accounts');
  }

  const db = buildDatabase(c.env);
  const terms = await checkTermsAcceptance(db, payload.sub, c.env);
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
