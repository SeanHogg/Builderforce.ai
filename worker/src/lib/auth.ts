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
 * REVOCATION. A signature check cannot see a sign-out, a force-logout or an admin
 * revoke: the api records those against the token's `jti`, and this worker has no
 * session store. So after the signature passes, a token that carries a `jti` is
 * introspected against the api (`lib/sessionIntrospection.ts`), with the verdict
 * cached in the api's OWN KV namespace so the api's revoke path invalidates it.
 * A revoked token is refused (401); an api that cannot answer fails CLOSED (503),
 * because "unknown" is not "live". Tokens WITHOUT a jti keep the signature-only
 * acceptance — the api makes the same exception for its machine tokens
 * (`agentHost:<id>` / `embed:<keyId>`), which are minted server-to-server, have no
 * token row to revoke, and are bounded by a short TTL and an active API key.
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
import { introspectSession, type SessionIntrospectionEnv } from './sessionIntrospection';

/** Bindings every worker route already carries plus the shared JWT signing secret. */
export interface WorkerAuthBindings extends SessionIntrospectionEnv {
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
 * Hono middleware: require a valid, un-revoked Bearer session token. 503 if the
 * server has no JWT_SECRET configured or the api cannot confirm the session (fail
 * closed); 401 on a missing/invalid/expired/revoked token.
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
  const token = match[1].trim();
  const payload = await verifySessionToken(token, secret);
  if (!payload?.sub) return c.json({ error: 'Unauthorized' }, 401);

  // A jti-bearing token is a revocable session token: ask the api whether it is
  // still live. No jti → signature-only, as the api does for its machine tokens.
  if (payload.jti) {
    let verdict;
    try {
      verdict = await introspectSession(c.env, token, payload.jti);
    } catch (error) {
      console.error('[worker:auth] session introspection failed — refusing request (fail closed).', error instanceof Error ? error.message : error);
      return c.json({ error: 'Session check unavailable' }, 503);
    }
    if (!verdict.active) return c.json({ error: 'Unauthorized' }, 401);
  }

  await next();
};
