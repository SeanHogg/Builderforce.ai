/**
 * Shared authentication middleware for the Builderforce worker (H9).
 *
 * The worker's data routes (projects, files, datasets, training, agents) sit at
 * `worker.builderforce.ai` behind only permissive CORS and previously enforced NO
 * authentication — any caller who knew a `projectId` could read/write/delete its R2
 * files and rows over the open internet. The frontend already sends the logged-in
 * user's session token as `Authorization: Bearer <jwt>` (see frontend getAuthHeaders);
 * the worker simply ignored it. This middleware verifies that token so only an
 * authenticated caller reaches the data routes.
 *
 * The token is the SAME HS256 (HMAC-SHA-256) JWT the api issues (JwtService.signJwt,
 * signed with JWT_SECRET). We verify it here with Web Crypto — no dependency, no
 * network hop — through `@builderforce/hs256-jwt`, the ONE verifier JwtService itself
 * uses, so the two can never drift. The worker must be given the SAME `JWT_SECRET` as the api
 * (`wrangler secret put JWT_SECRET` in the worker/ dir); if it is unset the middleware
 * FAILS CLOSED (503) rather than allowing an auth bypass.
 *
 * Ownership note: the worker's `projects` table has no real per-tenant owner model
 * (rows are created with `owner_id='anonymous'`), so this gate authenticates the
 * caller as a valid session but cannot enforce per-project ownership against that
 * table. Requiring a valid session is the correct, complete fix for THIS surface; the
 * tenant-scoped file store with true ownership checks is the api's `workspaceStore`
 * (`/api/ide/projects/:id/files`), which the frontend uses when NEXT_PUBLIC_WORKER_URL
 * is unset.
 */
import type { MiddlewareHandler } from 'hono';
import { verifyHs256 } from '@builderforce/hs256-jwt';

/** Bindings every worker route already carries plus the shared JWT signing secret. */
export interface WorkerAuthBindings {
  JWT_SECRET?: string;
}

interface WorkerJwtPayload {
  sub?: string;
  tid?: number;
  exp: number;
  jti?: string;
}

/** The API's session token, verified by the SAME implementation the API uses
 *  (`@builderforce/hs256-jwt`): signature first, then `exp`, then `nbf`. */
async function verifySessionToken(token: string, secret: string): Promise<WorkerJwtPayload | null> {
  try {
    const verdict = await verifyHs256<WorkerJwtPayload & { exp: number }>(token, secret);
    return verdict.ok ? verdict.claims : null;
  } catch {
    return null;
  }
}

/**
 * Hono middleware: require a valid Bearer session token. 503 if the server has no
 * JWT_SECRET configured (fail closed), 401 on missing/invalid/expired token.
 */
export const requireAuth: MiddlewareHandler<{ Bindings: WorkerAuthBindings }> = async (c, next) => {
  const secret = c.env.JWT_SECRET;
  if (!secret) {
    console.error('[worker:auth] JWT_SECRET is not configured — refusing request (fail closed). Set it with: wrangler secret put JWT_SECRET (in worker/).');
    return c.json({ error: 'Server authentication is not configured' }, 503);
  }
  const authz = c.req.header('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authz);
  if (!match) return c.json({ error: 'Unauthorized' }, 401);
  const payload = await verifySessionToken(match[1].trim(), secret);
  if (!payload?.sub) return c.json({ error: 'Unauthorized' }, 401);
  await next();
};
