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
import { parseMachineSubject } from '../../infrastructure/auth/machineSubject';
import type { TransitionActorInput } from '../../application/task/taskLifecycle';
import { updateCaughtErrorContext } from '../../application/observability/caughtErrorReporter';

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

  // Machine tokens (sub `agentHost:<id>` / `embed:<keyId>`) are minted server-to-server
  // and intentionally have no `authTokens`/session row — their userId FK would not
  // resolve to a real user. Skip the jti-revocation and terms checks for them; they are
  // already bounded by a short TTL and gated on an active API key. Decoded through the
  // ONE machine-subject parser so every consumer agrees on which subs are machines.
  const machineActor = parseMachineSubject(payload.sub);
  const isMachineToken = machineActor !== null;
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
  // Machine callers keep `userId` (every tenant-scoped read still needs a subject) but
  // ALSO publish their machine identity, so a write that records WHO did something can
  // tell an on-prem agent host from a person instead of filing it under a fake user id.
  if (machineActor) c.set('machineActor', machineActor);
  // …and a cloud agent replaying a route as itself publishes the agent it acts as, so a
  // write can credit the agent rather than the ref parked in `sub`.
  if (payload.agt) c.set('agentActorRef', payload.agt);
  if (payload.src === 'vscode') c.set('clientSurface', 'vscode');
  updateCaughtErrorContext({ tenantId: payload.tid, userId: payload.sub });
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
 * Auth when there IS auth, and no failure when there is not.
 *
 * For a read whose answer is *narrower* without a workspace rather than
 * forbidden — the team roster is the case this exists for: signed in it is your
 * team, signed out it is the always-on seats, locked. One endpoint answering both
 * is what lets the shell be the same surface for both visitors (PRD 21 §0);
 * two endpoints would be two rosters, which §4.1 exists to prevent.
 *
 * Delegates to {@link authMiddleware} rather than re-deriving the token rules —
 * revocation, session-version and segment resolution all still apply to a caller
 * who DOES present a token. Only the rejection is swallowed, so a handler behind
 * this must treat `tenantId` as possibly absent.
 */
export const optionalAuthMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  try {
    // `authMiddleware` does no work after its own `next()`, so handing it a no-op
    // and continuing here runs its full contract exactly once.
    await authMiddleware(c, async () => {});
  } catch (err) {
    // Anything that is not "you are not signed in" is a real failure and must
    // keep its status — an expired token is still just an anonymous caller, but
    // a database error is not.
    if (!(err instanceof UnauthorizedError)) throw err;
  }
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
 * The request's caller as a lifecycle ACTOR — the one place a route turns "who is
 * authenticated" into "who did this".
 *
 * A machine caller's `userId` is its service subject (`agentHost:5`), not a person, so
 * handing it to a writer as `actorUserId` files an agent's work under a user id that
 * does not exist. This returns the machine identity instead when there is one, and the
 * plain user id otherwise — so `resolveTransitionActor` can classify it correctly
 * without every route re-learning the token shapes.
 */
export function requestActor(c: Context<HonoEnv>): TransitionActorInput {
  // Agent identities are returned WITHOUT a user id, deliberately: a cloud agent's
  // replay carries its own ref in `sub`, and letting that through as `actorUserId`
  // would take the human branch and re-create the bug this exists to close.
  const agentRef = c.get('agentActorRef');
  if (agentRef) return { actorAgentRef: agentRef };

  const machine = c.get('machineActor');
  if (machine) return { actorAgentHostId: machine.agentHostId };

  return { actorUserId: c.get('userId') ?? null };
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
