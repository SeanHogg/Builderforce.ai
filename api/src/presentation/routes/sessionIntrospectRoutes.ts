import { Hono } from 'hono';
import { decodeJwtPayload } from '@builderforce/hs256-jwt';
import type { SessionIntrospection } from '@builderforce/session-introspection';
import type { HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import { optionalTenantId } from '../middleware/tenantContext';

/**
 * `GET /api/auth/introspect` — "is the bearer token I am holding still live?"
 *
 * The legacy worker verifies the API's session token by signature alone and has
 * no session store, so it asks here and caches the answer in the shared
 * `AUTH_CACHE_KV` under the key `revokeSessionTokens` invalidates
 * (`@builderforce/session-introspection`).
 *
 * The verdict IS `authMiddleware`'s verdict: signature, `exp`, the `jti` row and
 * its session, and `users.session_version` are all checked before this handler
 * runs, so a revoked token never reaches it — the middleware answers 401, and the
 * worker caches THAT as `{ active: false, reason: 'revoked' }`. The handler only
 * has to describe the token it was handed.
 *
 * Mounted inside `createAuthRoutes` (one `router.route('/', …)` line) so the path
 * is `/api/auth/introspect` without another entry in `index.ts`.
 */
export function createSessionIntrospectRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/introspect', authMiddleware, (c) => {
    // A machine token (`agentHost:<id>` / `embed:<keyId>`) carries no jti and is
    // not revocable per token, so there is no verdict to cache for it.
    const jti = c.get('tokenJti');
    if (!jti) return c.json({ error: 'Token carries no jti to introspect' }, 400);

    // `exp` is not a context variable; the token is, so read the claim off it.
    // Header first, `?token=` second — the same order the middleware accepted it in.
    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : c.req.query('token');
    const { exp } = decodeJwtPayload<{ exp: number }>(token ?? '');

    const verdict: SessionIntrospection = {
      active: true,
      sub: c.get('userId') as string,
      tenantId: optionalTenantId(c),
      jti,
      exp,
    };
    return c.json(verdict);
  });

  return router;
}
