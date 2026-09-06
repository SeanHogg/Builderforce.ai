import type { Context, MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { UnauthorizedError } from '../../domain/shared/errors';
import { verifyWebJwt } from '../../infrastructure/auth/JwtService';
import { buildDatabase } from '../../infrastructure/database/connection';
import { checkTermsAcceptance } from '../../application/legal/termsAcceptance';
import { assertActiveToken, findActiveToken, lastSeenWrites } from '../../application/auth/sessionRevocation';
import { background } from './background';

/**
 * Paths exempt from the terms-acceptance gate. These are the endpoints required
 * to fetch, display, and accept the current terms — gating them would make a
 * terms version bump unrecoverable for existing users.
 */
export function isTermsExemptPath(path: string): boolean {
  return path.startsWith('/api/auth/legal') || path === '/api/auth/me';
}

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
  /**
   * A WebSocket upgrade cannot carry an Authorization header — the browser API
   * has no way to set one — so a live room under this middleware has to accept
   * `?token=`. `authMiddleware` already does, unconditionally; this one accepts
   * it ONLY on an upgrade request, which is strictly narrower: a token in a query
   * string can leak through a Referer header or an access log, and no ordinary
   * navigation or XHR carries `Upgrade: websocket`.
   */
  const upgrade = c.req.header('Upgrade')?.toLowerCase() === 'websocket';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : upgrade ? (c.req.query('token') ?? '') : '';
  if (!token) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }
  let payload;
  try {
    payload = await verifyWebJwt(token, c.env.JWT_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }

  // ONE connection for the whole middleware — shared by the revocation check and
  // the terms gate below (each used to build its own).
  const db = buildDatabase(c.env);

  if (payload.jti) {
    // Same revocation contract as authMiddleware, from the one shared
    // implementation: a single LEFT JOIN read plus throttled, off-critical-path
    // last-seen refreshes.
    const active = assertActiveToken(await findActiveToken(db, payload.sub, payload.jti));
    background(c, lastSeenWrites(db, active));
    c.set('tokenJti', payload.jti);
  }

  // The terms gate blocks every authed endpoint EXCEPT the ones needed to
  // bootstrap the acceptance UI itself — otherwise a terms version bump locks
  // returning users out of the very screen that lets them re-accept:
  //   - /api/auth/legal/*  → fetch active terms + POST acceptance
  //   - /api/auth/me       → read-only identity, required to persist the
  //                          session in the OAuth/login callback before the
  //                          OnboardingGate can render TermsAcceptanceScreen
  // Action/tenant endpoints stay gated, so users still cannot use the app
  // until they accept.
  if (!isTermsExemptPath(c.req.path)) {
    const terms = await checkTermsAcceptance(db, payload.sub, c.env);
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

/**
 * Non-throwing web-token probe — the user id when a VALID, UNREVOKED web token is
 * present, `null` otherwise. For a public read whose answer is narrower without a
 * signed-in person (a job's private visibility, a like's own-state), never for an
 * action.
 *
 * Five route files used to re-implement only the signature half of this check,
 * so a token the person had already signed out of still identified them on the
 * freelancer, job, marketplace and messaging surfaces. This is the middleware's
 * own contract minus the terms gate: an optional identity narrows a read, it
 * never unlocks something the terms gate would have withheld.
 */
export async function optionalWebUserId(c: Context<HonoEnv>): Promise<string | null> {
  const authHeader = c.req.header('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  let payload: Awaited<ReturnType<typeof verifyWebJwt>>;
  try {
    payload = await verifyWebJwt(authHeader.slice(7), c.env.JWT_SECRET);
  } catch {
    return null;
  }
  if (payload.jti) {
    try {
      assertActiveToken(await findActiveToken(buildDatabase(c.env), payload.sub, payload.jti));
    } catch (err) {
      if (err instanceof UnauthorizedError) return null;
      throw err;
    }
  }
  return payload.sub ?? null;
}
