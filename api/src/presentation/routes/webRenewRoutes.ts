import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { renewWebSession, type RenewContext } from '../../application/auth/renewWebSession';

/**
 * `POST /api/auth/web/renew` — swap the current web token for a fresh short-lived one.
 *
 * Deliberately NOT behind `webAuthMiddleware`: that rejects an expired token, and
 * renewal has to accept one that lapsed moments ago (the tab was asleep). The
 * use case does its own verification, grace window and revocation check.
 *
 * Every refusal is a 401 carrying a machine-readable `code`; `session_expired` means
 * the session reached its maximum age and the person has to sign in again.
 *
 * Mounted inside `createAuthRoutes` (one `router.route('/', …)` line), like
 * `createSessionIntrospectRoutes`.
 */
export function createWebRenewRoutes(db: Db, isSuperadmin: RenewContext['isSuperadmin']): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/web/renew', async (c) => {
    const header = c.req.header('Authorization') ?? '';
    if (!header.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or malformed Authorization header', code: 'invalid_token' }, 401);
    }
    const result = await renewWebSession(db, c.env, header.slice(7), {
      isSuperadmin,
      userAgent: c.req.header('User-Agent')?.slice(0, 1024) ?? null,
      ipAddress: c.req.header('CF-Connecting-IP')?.trim() ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null,
    });
    if (!result.ok) return c.json({ error: result.error, code: result.code }, 401);
    return c.json({ token: result.token, expiresIn: result.expiresIn, sessionExpiresAt: result.sessionExpiresAt });
  });

  return router;
}
