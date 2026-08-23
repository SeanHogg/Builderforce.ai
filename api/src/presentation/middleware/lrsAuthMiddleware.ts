/**
 * xAPI Basic authentication, as middleware.
 *
 * ── WHY THIS IS NOT SIMPLY DONE IN THE HANDLERS ─────────────────────────────
 * Because the rate limiter runs before them. `rateLimitMiddleware` throttles per
 * TENANT and resolves that tenant from `c.get('tenantId')` or a Bearer token —
 * neither of which an xAPI client sends. So an LRS endpoint whose handlers did
 * their own authentication would be the one authenticated, externally-driven
 * write path on the deployment with NO rate limit at all: a leaked authoring-tool
 * credential would be worth an unbounded write rate against `activity_log`.
 *
 * Resolving the credential here, before the limiter, is what closes that. It also
 * means the lookup happens once per request rather than once per handler.
 *
 * ── IT NEVER REFUSES ────────────────────────────────────────────────────────
 * On failure it sets nothing and calls `next()`, leaving the refusal to the
 * handler. Two reasons: `GET /xapi/about` is public by the specification — a
 * client asks what an endpoint supports before it has credentials for it — and
 * the 401 an xAPI client needs carries a `WWW-Authenticate` challenge and the
 * version header, which is response shaping the router already owns.
 */

import type { MiddlewareHandler } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import { authenticateLrsRequest } from '../../application/learning/lrsCredentials';

export function createLrsAuthMiddleware(db: Db): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const auth = await authenticateLrsRequest(db, c.env as Env, c.req.header('Authorization'));
    if (auth.ok) {
      c.set('tenantId', auth.tenantId);
      c.set('lrsConnectionId', auth.connectionId);
    } else {
      // Carried so the handler can answer 401 vs 403 without repeating the
      // lookup — the difference matters (see `authenticateLrsRequest`).
      c.set('lrsAuthFailure', auth);
    }
    return next();
  };
}
