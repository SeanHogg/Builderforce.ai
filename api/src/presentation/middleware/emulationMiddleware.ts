import { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { verifyEmulationJwt } from '../../infrastructure/auth/JwtService';
import type { EmulationJwtPayload } from '../../infrastructure/auth/JwtService';
import { ForbiddenError, UnauthorizedError } from '../../domain/shared/errors';
import { buildDatabase } from '../../infrastructure/database/connection';
import {
  loadEmulationSession,
  recordEmulationPageVisit,
  recordEmulationWriteBlock,
} from '../../application/admin/emulationSessions';
import { background } from './background';
import { updateRequestScope } from '../../application/shared/requestScope';

// ---------------------------------------------------------------------------
// Mutating HTTP methods that are blocked when emu_readonly: true
// ---------------------------------------------------------------------------
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Emulation middleware — must run before authMiddleware on tenant routes.
 *
 * When `X-Emulation-Token` is present:
 *   1. Validates the emulation JWT (signature + expiry).
 *   2. Confirms the session record is still active (read-through cached — an
 *      ended session stops working within ~60s everywhere, at once in the isolate
 *      that ended it; see `application/admin/emulationSessions`).
 *   3. Rejects mutating verbs (POST/PUT/PATCH/DELETE) — emu_readonly enforcement.
 *      Increments `write_block_count` on the session record for audit purposes.
 *   4. Injects `userId`, `tenantId`, `role` from the emulation token (overrides
 *      any tenant JWT in the Authorization header).
 *   5. Marks the request as emulation: `c.set('isEmulation', true)`.
 *
 * When absent, calls next() immediately (regular authMiddleware takes over).
 */
export const emulationMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const emulationHeader = c.req.header('X-Emulation-Token');
  if (!emulationHeader) {
    await next();
    return;
  }

  // Verify emulation JWT
  let payload: EmulationJwtPayload;
  try {
    payload = await verifyEmulationJwt(emulationHeader, c.env.JWT_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid or expired emulation token');
  }

  const db = buildDatabase(c.env);

  // Confirm session is still active — cached, since this runs on every emulated request.
  const session = await loadEmulationSession(c.env, db, payload.tid, payload.emu_sid);

  if (!session || session.ended) {
    throw new UnauthorizedError('Emulation session has ended or does not exist');
  }

  // Reject current JTI if it has been superseded (role switch invalidates old JTI)
  if (session.tokenJti && payload.jti && session.tokenJti !== payload.jti) {
    throw new UnauthorizedError('Emulation token has been superseded by a role switch');
  }

  // Write-block enforcement
  if (MUTATING_METHODS.has(c.req.method)) {
    // Increment write_block_count for audit trail
    await recordEmulationWriteBlock(db, payload.tid, payload.emu_sid);

    throw new ForbiddenError(
      'Write operations are not permitted during an emulation session (read-only mode)',
    );
  }

  // Inject emulation identity into context
  c.set('userId',     payload.sub);
  c.set('tenantId',   payload.tid);
  c.set('role',       payload.role);
  c.set('isEmulation', true);
  updateRequestScope({ tenantId: payload.tid, userId: payload.sub });

  await next();

  // Track page visits (GET only), once per distinct path, after the response —
  // best-effort, so an audit write can never fail the request.
  if (c.req.method === 'GET') {
    const path = new URL(c.req.url).pathname;
    background(c, recordEmulationPageVisit(c.env, db, payload.tid, payload.emu_sid, path));
  }
};
