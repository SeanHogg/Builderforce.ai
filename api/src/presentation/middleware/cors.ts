import { Context, MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';

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

/** Request headers the browser may SEND (preflight allow-list).
 *  X-Builderforce-Locale carries the user's picked locale (see i18n/config.ts +
 *  emailLocaleResolver). If-Match carries the optimistic-concurrency revision
 *  for creation-session commands. Omitting either makes the browser reject the
 *  preflight before the request reaches its route. */
export const ALLOWED_REQUEST_HEADERS =
  'Content-Type,Authorization,Idempotency-Key,If-Match,X-Emulation-Token,X-AgentHost-Signature,X-Builderforce-Locale';

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

/**
 * PUBLIC INGEST surfaces — the embeddable snippets (error collectors, feedback
 * collectors). These are pasted into CUSTOMER applications on origins we cannot
 * enumerate, which is the entire point of an embeddable snippet, so the origin
 * allow-list can never gate them: any browser origin may post.
 *
 * Same reasoning as the editor-webview exception above — authorization is the
 * per-collector ingest key carried on every request (plus the collector's own
 * rate/quota ceilings), and CORS is not the security boundary. Before this, a
 * customer embedding the quality snippet on their own domain got a silent
 * preflight rejection unless the deployment set CORS_ORIGINS=*.
 */
const PUBLIC_INGEST_PREFIXES = ['/api/quality-ingest', '/api/feedback-ingest'];

function isPublicIngestPath(path: string): boolean {
  return PUBLIC_INGEST_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * THE origin decision. Returns the `Access-Control-Allow-Origin` value for this
 * request, or `null` when the origin is refused.
 *
 * Shared with the worker's OPTIONS short-circuit in `index.ts`, which answers
 * preflights before the app (and therefore before the database) is built. That
 * short-circuit used to carry its OWN copy of this rule, and the copy had drifted
 * in three ways that all point the same direction:
 *
 *   • it answered a REFUSED origin with `*` instead of a 403, so the browser
 *     was told the preflight passed and then received a real response with no
 *     `Access-Control-Allow-Origin` header at all — reported by every browser as
 *     "No 'Access-Control-Allow-Origin' header is present" on EVERY endpoint, the
 *     exact symptom of a Cloudflare-level outage and nothing like its cause;
 *   • it did not know about `vscode-webview://` origins;
 *   • it did not know about the public ingest paths, which must accept any origin.
 *
 * One function, both call sites: the preflight can no longer promise something
 * the real response refuses.
 */
export function resolveAllowedOrigin(
  origin: string | null | undefined,
  corsOrigins: string | undefined,
  pathname: string,
): string | null {
  const value = origin ?? '';
  const configured = corsOrigins ?? 'https://builderforce.ai';
  const allowAll = configured === '*' || isPublicIngestPath(pathname);
  if (allowAll) return '*';
  const allowed = configured.split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(value) || DEV_ORIGINS.includes(value) || isEditorWebviewOrigin(value)) return value;
  return null;
}

/**
 * A refused origin is INVISIBLE to the browser by construction — the spec gives us
 * no way to say "your origin is not on the list", only the absence of a header,
 * which reads to the developer as a broken server. So it is recorded here instead.
 * Without this, a `CORS_ORIGINS` that no longer matches the deployed frontend
 * (a renamed host, a preview deployment, `www` vs the apex) presents as a total
 * outage with no trace anywhere on the server side to explain it.
 */
export function reportRefusedOrigin(origin: string | null | undefined, pathname: string, corsOrigins: string | undefined): void {
  if (!origin) return; // No Origin header at all: a non-browser client, not a refusal.
  reportCaughtError(new Error(`CORS origin refused: ${origin}`), {
    source: 'cors.ts',
    operation: 'resolveAllowedOrigin',
    level: 'warning',
    context: { origin, path: pathname, configured: corsOrigins ?? '(default)' },
  });
}

function getCorsConfig(c: Context<HonoEnv>) {
  const origin = c.req.header('Origin') ?? '';
  const pathname = new URL(c.req.url).pathname;
  const allowOriginValue = resolveAllowedOrigin(origin, c.env.CORS_ORIGINS, pathname);
  return {
    isAllowed: allowOriginValue !== null,
    allowOriginValue,
    isWebSocket: c.req.header('Upgrade')?.toLowerCase() === 'websocket',
  };
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
      reportRefusedOrigin(c.req.header('Origin'), new URL(c.req.url).pathname, c.env.CORS_ORIGINS);
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

  if (!allowOriginValue && !isWebSocket) {
    // The response is about to go out with no CORS header — the one failure mode a
    // browser cannot describe accurately. Leave a trace that can.
    reportRefusedOrigin(c.req.header('Origin'), new URL(c.req.url).pathname, c.env.CORS_ORIGINS);
  }

  // WebSocket upgrade responses (101) are immutable in Cloudflare Workers; skip CORS.
  if (allowOriginValue && !isWebSocket && c.res) {
    c.res.headers.set('Access-Control-Allow-Origin', allowOriginValue);
    // On the ACTUAL response — this is the only placement a browser honours. Without
    // it every `x-builderforce-*` header the gateway sets is unreadable from JS.
    c.res.headers.set('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    c.res.headers.set('Vary', 'Origin');
  }
};
