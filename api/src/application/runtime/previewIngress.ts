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
import type { Env } from '../../env';

/** The public host the preview ingress answers on. */
export const PREVIEW_HOST = 'preview.builderforce.ai';

/** Path prefix the container's dev-server passthrough (`server.mjs`) listens on, so a
 *  preview request can't collide with the container's own `/health` / `/run` ops. */
export const PREVIEW_CONTAINER_PATH_PREFIX = '/__preview__';

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
  const token = segments.shift() ?? '';
  if (!token) return new Response('Missing preview token.', { status: 400 });

  const secret = env.JWT_SECRET ?? '';
  // Date.now() is available in the Worker runtime (only workflow scripts forbid it).
  const verified = secret ? await verifyPreviewToken(secret, token, Date.now() / 1000) : null;
  if (!verified) return new Response('Invalid or expired preview link.', { status: 401 });

  // Rewrite `/<token>/<rest>` → `/__preview__/<rest>` and forward the untouched request
  // (method, headers, body, and any WebSocket upgrade) to the run's container DO.
  const rest = segments.join('/');
  const containerUrl = `https://agent-container${PREVIEW_CONTAINER_PATH_PREFIX}/${rest}${url.search}`;
  try {
    const stub = env.AGENT_CONTAINER.get(env.AGENT_CONTAINER.idFromName(`exec:${verified.executionId}`));
    return await stub.fetch(new Request(containerUrl, req));
  } catch {
    return new Response('Preview container unavailable.', { status: 502 });
  }
}
