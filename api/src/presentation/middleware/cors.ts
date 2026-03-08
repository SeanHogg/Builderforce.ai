import { Context, MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';

const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];

function getCorsConfig(c: Context<HonoEnv>) {
  const origin = c.req.header('Origin') ?? '';
  const corsOrigins = c.env.CORS_ORIGINS ?? 'https://builderforce.ai';
  const allowAll = corsOrigins === '*';
  const allowed = allowAll
    ? []
    : corsOrigins.split(',').map((s) => s.trim()).filter(Boolean);
  const isAllowed = allowAll || allowed.includes(origin) || DEV_ORIGINS.includes(origin);
  const allowOriginValue = isAllowed ? (allowAll ? '*' : origin) : null;
  return { isAllowed, allowOriginValue, isWebSocket: c.req.header('Upgrade')?.toLowerCase() === 'websocket' };
}

/**
 * Add CORS headers to a Response. Use for error/notFound responses that bypass the middleware.
 */
export function addCorsToResponse(c: Context<HonoEnv>, res: Response): Response {
  const { allowOriginValue, isWebSocket } = getCorsConfig(c);
  if (!allowOriginValue || isWebSocket) return res;
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', allowOriginValue);
  headers.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * CORS middleware.
 *
 * Reads allowed origins from the CORS_ORIGINS environment variable
 * (comma-separated). Allows * or explicit list; always allows common dev origins (localhost).
 */
export const corsMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const { isAllowed, allowOriginValue, isWebSocket } = getCorsConfig(c);

  if (c.req.method === 'OPTIONS') {
    if (!isAllowed) {
      return c.newResponse(null, 403);
    }
    return c.newResponse(null, 204, {
      'Access-Control-Allow-Origin': allowOriginValue!,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    });
  }

  await next();

  // WebSocket upgrade responses (101) are immutable in Cloudflare Workers; skip CORS.
  if (allowOriginValue && !isWebSocket && c.res) {
    c.res.headers.set('Access-Control-Allow-Origin', allowOriginValue);
    c.res.headers.set('Vary', 'Origin');
  }
};
