import { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { verifyWebJwt } from '../../infrastructure/auth/JwtService';
import { UnauthorizedError, ForbiddenError } from '../../domain/shared/errors';
import { buildDatabase } from '../../infrastructure/database/connection';
import { checkTermsAcceptance } from './termsEnforcement';

const SUPERADMIN_EMAIL = 'seanhogg@gmail.com';

/**
 * Middleware that gates access to superadmin-only endpoints.
 *
 * Expects a WebJWT (24-hour session token) with `sa: true` claim.
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

  if (!payload.sa) {
    throw new ForbiddenError('Superadmin access required');
  }

  const email = (payload.email ?? '').toLowerCase().trim();
  if (email !== SUPERADMIN_EMAIL) {
    throw new ForbiddenError('Superadmin access is restricted to the platform owner account');
  }

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

  c.set('userId', payload.sub);
  await next();
};
