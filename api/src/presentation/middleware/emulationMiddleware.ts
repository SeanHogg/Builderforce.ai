import { MiddlewareHandler } from 'hono';
import { eq, sql } from 'drizzle-orm';
import type { HonoEnv } from '../../env';
import { verifyJwt } from '../../infrastructure/auth/JwtService';
import type { EmulationJwtPayload } from '../../infrastructure/auth/JwtService';
import { ForbiddenError, UnauthorizedError } from '../../domain/shared/errors';
import { buildDatabase } from '../../infrastructure/database/connection';
import { adminImpersonationSessions } from '../../infrastructure/database/schema';

// ---------------------------------------------------------------------------
// Mutating HTTP methods that are blocked when emu_readonly: true
// ---------------------------------------------------------------------------
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Emulation middleware — must run before authMiddleware on tenant routes.
 *
 * When `X-Emulation-Token` is present:
 *   1. Validates the emulation JWT (signature + expiry).
 *   2. Confirms the session record is still active in the DB.
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
    const raw = await verifyJwt(emulationHeader, c.env.JWT_SECRET) as EmulationJwtPayload;
    if (!raw.emu) throw new Error('Not an emulation token');
    payload = raw;
  } catch {
    throw new UnauthorizedError('Invalid or expired emulation token');
  }

  const db = buildDatabase(c.env);

  // Confirm session is still active in DB
  const [session] = await db
    .select({
      id: adminImpersonationSessions.id,
      endedAt: adminImpersonationSessions.endedAt,
      tokenJti: adminImpersonationSessions.tokenJti,
      writeBlockCount: adminImpersonationSessions.writeBlockCount,
    })
    .from(adminImpersonationSessions)
    .where(eq(adminImpersonationSessions.id, payload.emu_sid))
    .limit(1);

  if (!session || session.endedAt !== null) {
    throw new UnauthorizedError('Emulation session has ended or does not exist');
  }

  // Reject current JTI if it has been superseded (role switch invalidates old JTI)
  if (session.tokenJti && payload.jti && session.tokenJti !== payload.jti) {
    throw new UnauthorizedError('Emulation token has been superseded by a role switch');
  }

  // Write-block enforcement
  if (MUTATING_METHODS.has(c.req.method)) {
    // Increment write_block_count for audit trail
    await db
      .update(adminImpersonationSessions)
      .set({ writeBlockCount: sql`${adminImpersonationSessions.writeBlockCount} + 1` })
      .where(eq(adminImpersonationSessions.id, session.id));

    throw new ForbiddenError(
      'Write operations are not permitted during an emulation session (read-only mode)',
    );
  }

  // Inject emulation identity into context
  c.set('userId',     payload.sub);
  c.set('tenantId',   payload.tid);
  c.set('role',       payload.role);
  c.set('isEmulation', true);

  await next();

  // Track page visits (GET requests only, fire-and-forget to not block response)
  if (c.req.method === 'GET') {
    const path = new URL(c.req.url).pathname;
    // Append to pages_visited JSONB array; use fire-and-forget (no await)
    db
      .update(adminImpersonationSessions)
      .set({
        pagesVisited: sql`jsonb_insert(coalesce(pages_visited, '[]'::jsonb), '{-1}', to_jsonb(${JSON.stringify({ path, ts: new Date().toISOString() })}::text))`,
      })
      .where(eq(adminImpersonationSessions.id, session.id))
      .catch(() => undefined);  // best-effort; ignore errors
  }
};
