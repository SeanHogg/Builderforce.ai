import { MiddlewareHandler, type Context } from 'hono';
import type { HonoEnv } from '../../env';
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import { UnauthorizedError, ForbiddenError } from '../../domain/shared/errors';
import { verifyJwt } from '../../infrastructure/auth/JwtService';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import { buildDatabase } from '../../infrastructure/database/connection';
import { users } from '../../infrastructure/database/schema';
import { eq } from 'drizzle-orm';
import { checkTermsAcceptance } from '../../application/legal/termsAcceptance';
import { assertActiveToken, findActiveToken, lastSeenWrites } from '../../application/auth/sessionRevocation';
import { background } from './background';

/**
 * JWT authentication middleware.
 *
 * Reads `Authorization: Bearer <token>`, verifies it, and injects
 * `userId`, `tenantId`, and `role` into Hono context variables.
 *
 * Apply to any route that requires a logged-in user.
 *
 * PERFORMANCE — this runs on every authenticated request, so its shape matters:
 *   - ONE `Db` is built per request and reused (it used to be built four times).
 *   - The session-version check and the token/session revocation check are
 *     INDEPENDENT reads, so they are issued in parallel rather than in sequence.
 *   - The token and its session come back in a single LEFT JOIN
 *     (`findActiveToken`) instead of two sequential selects.
 *   - `last_seen_at` writes are throttled to once a minute and moved off the
 *     critical path.
 *   - Terms acceptance is served from the read-through cache and invalidated by
 *     the accept/publish paths.
 *
 * Worst case is now two parallel reads plus an in-isolate segment lookup, against
 * the seven sequential round-trips — two of them writes — it replaced.
 */
export const authMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  // If the emulation middleware already populated userId/tenantId/role (via
  // X-Emulation-Token), skip standard JWT verification — the emulation context
  // is already set and the write-block enforcement has already run.
  if (c.get('isEmulation')) {
    await next();
    return;
  }

  // WebSocket endpoints (and some clients) may send auth via ?token= rather
  // than via Authorization header. Support both for compatibility.
  const header = c.req.header('Authorization') ?? '';
  const tokenParam = c.req.query('token');
  const token = header.startsWith('Bearer ') ? header.slice(7) : tokenParam;

  if (!token) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }

  let payload;
  try {
    payload = await verifyJwt(token, c.env.JWT_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }

  // ONE connection for the whole request — later middleware (requirePermission)
  // and route handlers read it off the context instead of opening their own.
  const db = buildDatabase(c.env);
  c.set('db', db);

  // Machine tokens (sub `agentHost:<id>`) are minted by the API-key exchange and
  // carry a jti but intentionally have no `authTokens`/session row — their
  // userId FK would not resolve to a real user. Skip the jti-revocation check for
  // them; they are already bounded by a short TTL and gated on an active API key.
  const isMachineToken = payload.sub.startsWith('agentHost:');
  const checksSessionVersion = typeof payload.sv === 'number';
  const checksRevocation = !!payload.jti && !isMachineToken;

  // Both reads are independent — issue them together rather than one after the other.
  const [userRows, activeTokenRow] = await Promise.all([
    checksSessionVersion
      ? db
          .select({ sessionVersion: users.sessionVersion })
          .from(users)
          .where(eq(users.id, payload.sub))
          .limit(1)
      : Promise.resolve([]),
    checksRevocation ? findActiveToken(db, payload.sub, payload.jti!) : Promise.resolve(null),
  ]);

  // session_version check — if the JWT carries an `sv` claim, verify it matches
  // the current value in the DB. Force-logout increments this counter, instantly
  // invalidating all existing tokens for the user without needing a blocklist.
  if (checksSessionVersion) {
    const userRow = userRows[0];
    if (!userRow || userRow.sessionVersion > (payload.sv as number)) {
      throw new UnauthorizedError('Session has been invalidated — please log in again');
    }
  }

  if (checksRevocation) {
    const active = assertActiveToken(activeTokenRow);
    background(c, lastSeenWrites(db, active));
    c.set('tokenJti', payload.jti!);
  }

  if (payload.tid == null) {
    throw new UnauthorizedError('This endpoint requires a workspace token; please select a workspace first');
  }

  if (!isMachineToken) {
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

  c.set('userId',   payload.sub);
  c.set('tenantId', payload.tid);
  c.set('role',     payload.role);
  if (payload.sid) c.set('sessionId', payload.sid);

  // Resolve the active segment (the isolation tier below the tenant). For a
  // 'single' tenant this is its default segment; for a 'segmented' tenant the
  // token's account/company claims map to the end-client segment. This is the
  // sole entry point that establishes (tenantId, segmentId) request scope.
  // `resolveSegment` serves this from a bounded, TTL'd in-isolate map, so it is
  // usually free.
  c.set('segmentId', await resolveSegment(db, payload.tid, { accountId: payload.acct, companyId: payload.co }));

  await next();
};

/**
 * Predicate: does the request's caller hold MANAGER role or higher? The one
 * spelling of the manager gate — use in a route body where `requireRole` (which
 * throws) isn't the right shape, e.g. a per-field or "own-or-manager" check.
 */
export function isManager(c: Context<HonoEnv>): boolean {
  return hasMinRole(c.get('role') as TenantRole, TenantRole.MANAGER);
}

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
