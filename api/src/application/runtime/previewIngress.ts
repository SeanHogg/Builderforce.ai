/**
 * Live container-preview ingress — Replit-parity phase 2 (flag-gated).
 *
 * A cloud run on the `container` surface can start a dev server inside its Linux
 * container (`AgentContainerDO`). This proxies a PUBLIC, signed URL
 * (`preview.builderforce.ai/<token>/*`) straight through the container DO to that
 * dev server — HTTP **and** WebSocket (so Vite/Metro HMR works) — so a phone can load
 * a live, hot-reloading preview by scanning a QR.
 *
 * OFF by default: unless `PREVIEW_INGRESS_ENABLED === 'true'` AND the `AGENT_CONTAINER`
 * binding exists, every preview request is a plain 404 — the feature is fully inert
 * (same shape as the Stripe / managed-TURN "set a secret to enable" seams), so this
 * scaffold ships without changing any behaviour until an operator turns it on against
 * a Containers-Paid account with a proxied `preview` DNS record. The container side of
 * the passthrough is `container/server.mjs` (`/__preview__/*` → the run's dev server).
 *
 * `preview` is already a RESERVED_SUBDOMAINS label, so `preview.builderforce.ai` falls
 * through the R2 site-hosting middleware to here instead of being 404'd as a user site.
 */
import { verifyPreviewToken } from './previewToken';
import { touchPreviewSession } from './previewSessions';
import type { Env } from '../../env';

/** The public host the preview ingress answers on. */
export const PREVIEW_HOST = 'preview.builderforce.ai';

/** Path prefix the container's dev-server passthrough (`server.mjs`) listens on, so a
 *  preview request can't collide with the container's own `/health` / `/run` ops. */
export const PREVIEW_CONTAINER_PATH_PREFIX = '/__preview__';

/**
 * The cookie that carries the preview token after the FIRST request.
 *
 * A dev server emits ROOT-relative URLs (`/src/main.tsx`, `/@vite/client`, the HMR
 * socket at `/`), because it has no idea it is being served under a `/<token>/` prefix.
 * Without this, the very first module the page asked for would arrive here with no
 * token and 400 — the preview would render an empty white page and every asset would
 * fail. Rewriting the app's own output to inject a prefix is not possible for the WS
 * handshake or for a dynamically-built URL, so the token is pinned to the BROWSER
 * instead: the tokened URL from the QR sets it, and every subsequent root-relative
 * request re-presents it.
 *
 * `HttpOnly` (no script needs it), `Secure`, `SameSite=Lax` — the phone navigates to the
 * URL top-level, and no cross-site POST should ever ride this. It is scoped to the
 * preview host only, and it is still just a bearer of the SAME signed, expiring token:
 * the cookie widens nothing the URL did not already grant.
 */
const PREVIEW_COOKIE = 'bf_preview';

/** Read the preview token a browser already holds for this host, if any. */
function cookieToken(req: Request): string {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === PREVIEW_COOKIE) return decodeURIComponent(v.join('='));
  }
  return '';
}

/** Looks like a preview token (`<id>.<exp>.<hmac>`) rather than an app path segment. */
function looksLikeToken(segment: string): boolean {
  return /^\d+\.\d+\.[0-9a-f]{64}$/.test(segment);
}

/**
 * Handle a preview-host request, or return null when the request isn't for the
 * preview host (so normal routing continues). A returned Response is terminal —
 * including a 101 WebSocket upgrade forwarded from the container.
 */
export async function maybeHandlePreviewIngress(env: Env, req: Request): Promise<Response | null> {
  const host = (req.headers.get('host') ?? '').split(':')[0]?.toLowerCase() ?? '';
  if (host !== PREVIEW_HOST) return null;

  // Feature gate: inert unless explicitly enabled AND the container binding is present.
  if (env.PREVIEW_INGRESS_ENABLED !== 'true' || !env.AGENT_CONTAINER) {
    return new Response('Live preview is not enabled.', { status: 404 });
  }

  const url = new URL(req.url);
  const segments = url.pathname.replace(/^\/+/, '').split('/');
  // A tokened URL (the QR, or a manual paste) pins the token to this browser; every
  // root-relative asset request afterwards arrives WITHOUT one and rides the cookie.
  const fromPath = looksLikeToken(segments[0] ?? '') ? (segments.shift() as string) : '';
  const token = fromPath || cookieToken(req);
  if (!token) return new Response('Missing preview token.', { status: 400 });

  const secret = env.JWT_SECRET ?? '';
  // Date.now() is available in the Worker runtime (only workflow scripts forbid it).
  const verified = secret ? await verifyPreviewToken(secret, token, Date.now() / 1000) : null;
  if (!verified) return new Response('Invalid or expired preview link.', { status: 401 });

  // Traffic IS the liveness signal — this is what makes idle eviction a measured fact
  // rather than a timeout guess. Throttled and never able to fail the request.
  await touchPreviewSession(env, verified.executionId);

  // Rewrite `/<token>/<rest>` (or a bare `/<rest>`) → `/__preview__/<rest>` and forward
  // the untouched request (method, headers, body, and any WebSocket upgrade) to the
  // run's container DO.
  const rest = segments.join('/');
  const containerUrl = `https://agent-container${PREVIEW_CONTAINER_PATH_PREFIX}/${rest}${url.search}`;
  try {
    const stub = env.AGENT_CONTAINER.get(env.AGENT_CONTAINER.idFromName(`exec:${verified.executionId}`));
    const proxied = await stub.fetch(new Request(containerUrl, req));
    if (!fromPath || proxied.status === 101) return proxied;
    // Pin the token on the entry request. A 101 carries no settable headers, and a WS
    // handshake is never the entry request anyway (the page loads first).
    const res = new Response(proxied.body, proxied);
    res.headers.append(
      'Set-Cookie',
      `${PREVIEW_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
    return res;
  } catch {
    return new Response('Preview container unavailable.', { status: 502 });
  }
}
