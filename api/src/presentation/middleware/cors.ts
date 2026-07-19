import { Context, MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';

const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];

/**
 * Response headers a browser client is allowed to READ.
 *
 * This MUST be set on the ACTUAL response — putting it only on the OPTIONS
 * preflight (as this API did) has no effect whatsoever, and every `x-builderforce-*`
 * header was silently unreadable from the web app. The visible symptom: the Brain
 * recorded its resolved model as the literal string `"default"` and rendered no
 * provenance chip, so "which model / whose account served this turn?" was
 * unanswerable on the web — while the VS Code webview, which is not subject to
 * browser CORS, saw all of it. The BYO-unresolved and provider-cap warnings were
 * invisible for the same reason.
 *
 * Single source, shared with the worker's own OPTIONS short-circuit in index.ts,
 * so the preflight and the real response can never advertise different lists.
 */
export const EXPOSED_HEADERS = [
  'x-request-id',
  'x-builderforce-model',
  'x-builderforce-vendor',
  'x-builderforce-account',
  'x-builderforce-byo-unresolved',
  'x-builderforce-provider-cap',
  'x-builderforce-premium-surcharge',
  'x-builderforce-trace-id',
  'x-builderforce-retries',
  'x-builderforce-product',
  'x-builderforce-effective-plan',
  'x-builderforce-daily-tokens-used',
  'x-builderforce-daily-tokens-limit',
  'x-builderforce-daily-tokens-remaining',
].join(',');

/** Request headers the browser may SEND (preflight allow-list). */
export const ALLOWED_REQUEST_HEADERS =
  'Content-Type,Authorization,Idempotency-Key,X-Emulation-Token,X-AgentHost-Signature';

/**
 * VS Code (and other editor) webviews load from an opaque, per-session origin
 * (`vscode-webview://<uuid>` / `vscode-file://`) that can't be enumerated in an
 * allow-list. The bundled BuilderForce Brain webview calls the gateway + /api/*
 * directly from that context, so we trust the SCHEME — authorization is enforced
 * by the Bearer token on every request, CORS is not the security boundary here.
 */
function isEditorWebviewOrigin(origin: string): boolean {
  return origin.startsWith('vscode-webview://') || origin.startsWith('vscode-file://');
}

function getCorsConfig(c: Context<HonoEnv>) {
  const origin = c.req.header('Origin') ?? '';
  const corsOrigins = c.env.CORS_ORIGINS ?? 'https://builderforce.ai';
  const allowAll = corsOrigins === '*';
  const allowed = allowAll
    ? []
    : corsOrigins.split(',').map((s) => s.trim()).filter(Boolean);
  const isAllowed =
    allowAll || allowed.includes(origin) || DEV_ORIGINS.includes(origin) || isEditorWebviewOrigin(origin);
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
      'Access-Control-Allow-Headers': ALLOWED_REQUEST_HEADERS,
      'Access-Control-Expose-Headers': EXPOSED_HEADERS,
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    });
  }

  await next();

  // WebSocket upgrade responses (101) are immutable in Cloudflare Workers; skip CORS.
  if (allowOriginValue && !isWebSocket && c.res) {
    c.res.headers.set('Access-Control-Allow-Origin', allowOriginValue);
    // On the ACTUAL response — this is the only placement a browser honours. Without
    // it every `x-builderforce-*` header the gateway sets is unreadable from JS.
    c.res.headers.set('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    c.res.headers.set('Vary', 'Origin');
  }
};
