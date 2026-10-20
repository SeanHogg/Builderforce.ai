/**
 * Shared platform transport deny gate (G02).
 *
 * Requests originate from host API clients, platform tools, webview fetch
 * adapters, embedded frontend clients, streams, sockets, and platform frames.
 * Gating only one of those paths leaves the others open. A custom base URL
 * and a redirect target are still platform transports: denial does not
 * depend on the origin.
 *
 * Call this before issuing a request, opening a stream or socket, or loading
 * a platform frame. This module does not fetch, open a socket, or load a frame.
 */

export const PLATFORM_TRANSPORT_DENIED = 'PLATFORM_TRANSPORT_DENIED';

export const PLATFORM_TRANSPORT_KINDS = ['http', 'stream', 'socket', 'frame'] as const;

export type PlatformTransportKind = (typeof PLATFORM_TRANSPORT_KINDS)[number];

export interface PlatformTransportRequest {
  readonly apiDenied: boolean;
  readonly kind: PlatformTransportKind;
  readonly url: string;
}

export interface PlatformTransportAllowed {
  readonly ok: true;
}

const ALLOWED: PlatformTransportAllowed = Object.freeze({ ok: true });

function denied(kind: string, url: string): never {
  throw Object.assign(new Error(PLATFORM_TRANSPORT_DENIED), {
    code: PLATFORM_TRANSPORT_DENIED,
    kind,
    url,
  });
}

/**
 * The only decision that may open a platform transport.
 * When the API is denied, every kind is refused, including a custom base
 * URL and a redirect URL. When it is not denied, the call may proceed.
 */
export function assertPlatformTransport(request: PlatformTransportRequest): PlatformTransportAllowed {
  if (request != null && request.apiDenied === true) denied(request.kind, request.url);
  return ALLOWED;
}
