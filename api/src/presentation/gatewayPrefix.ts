/**
 * Same-origin gateway prefix stripping — shared by BOTH Workers.
 *
 * Requests that arrive via `builderforce.ai/gateway/*` carry a `/gateway` path
 * prefix. We strip it BEFORE any routing or CORS handling so the entire API
 * surface is byte-identical whether a caller reached us on api.builderforce.ai
 * or on the whitelisted primary domain (corporate firewalls often block the
 * `api.` subdomain but allow the apex).
 *
 * This used to live inside `src/index.ts`; the Gateway Worker split (PRD 39 §1)
 * needs it too — `gatewayWorker.ts` serves `/gateway/llm/*`, and without the
 * strip those paths would not match the `/llm` mounts. So it lives here, in a
 * shared importable location both entries import.
 */
export const GATEWAY_PATH_PREFIX = '/gateway';

/**
 * Strip a leading `/gateway` from the request path (in place, no-op when the
 * prefix is absent). Returns the bare request when there is nothing to strip.
 */
export function stripGatewayPrefix(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname === GATEWAY_PATH_PREFIX) {
    url.pathname = '/';
  } else if (url.pathname.startsWith(`${GATEWAY_PATH_PREFIX}/`)) {
    url.pathname = url.pathname.slice(GATEWAY_PATH_PREFIX.length);
  } else {
    return request;
  }
  return new Request(url.toString(), request);
}
