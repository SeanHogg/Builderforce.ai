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
 * network hop — mirroring JwtService.verifyJwt exactly (base64url header.body, HMAC
 * verify, exp check). The worker must be given the SAME `JWT_SECRET` as the api
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

/** Bindings every worker route already carries plus the shared JWT signing secret. */
export interface WorkerAuthBindings {
  JWT_SECRET?: string;
}

interface WorkerJwtPayload {
  sub?: string;
  tid?: number;
  exp?: number;
  jti?: string;
}

/** base64url → bytes (JWT segments are base64url, no padding). */
function b64urlToBytes(segment: string): Uint8Array {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Verify an HS256 JWT against `secret`; return the payload or null (bad sig / shape / expired). */
async function verifyHs256(token: string, secret: string): Promise<WorkerJwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  } catch {
    return null;
  }
  const valid = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), new TextEncoder().encode(`${header}.${body}`));
  if (!valid) return null;
  let payload: WorkerJwtPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))) as WorkerJwtPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
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
  const payload = await verifyHs256(match[1].trim(), secret);
  if (!payload?.sub) return c.json({ error: 'Unauthorized' }, 401);
  await next();
};
