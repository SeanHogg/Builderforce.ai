import type { MiddlewareHandler } from 'hono';
import { tryDecodeJwtPayload } from '@builderforce/hs256-jwt';
import type { HonoEnv } from '../../env';
import { authMiddleware } from './authMiddleware';
import { webAuthMiddleware } from './webAuthMiddleware';

/**
 * Person-level auth: accepts EITHER a web token (no workspace yet — the picker
 * right after login, the agent-runtime CLI) OR a workspace token (the editor,
 * the mobile apps, a signed-in web tab).
 *
 * For endpoints whose answer is about the PERSON rather than the workspace the
 * token happens to be scoped to — "my workspaces", "create a workspace". They
 * used to exist once per token kind (`/api/auth/my-tenants` and
 * `/api/tenants/mine` for web tokens, `/api/vscode/tenants` for workspace
 * tokens), which is how the copies drifted.
 *
 * The unverified `tid` claim only PICKS which middleware runs; that middleware
 * then verifies the signature and applies its full contract (revocation, terms,
 * membership). A forged `tid` therefore buys nothing: it routes the token to
 * `authMiddleware`, which rejects a bad signature exactly as before.
 */
export const personAuthMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  // Emulation already populated a workspace context upstream.
  if (c.get('isEmulation')) return authMiddleware(c, next);
  const header = c.req.header('Authorization') ?? '';
  const claims = header.startsWith('Bearer ') ? tryDecodeJwtPayload<{ tid?: unknown }>(header.slice(7)) : null;
  return claims?.tid != null ? authMiddleware(c, next) : webAuthMiddleware(c, next);
};
