/**
 * The identity a WebSocket relay may trust.
 *
 * A Durable Object sees a socket, not a session: whatever the DO believes about
 * WHO is on the other end has to be told to it by the authed route that forwarded
 * the upgrade. These headers are that channel — the route strips any copy a client
 * sent and writes its own, so a forged header can never survive the hop.
 *
 * Declared in `domain/` because both ends need it and the layering rule forbids the
 * presentation side (`relayToRoom`) from importing the infrastructure side (the DO).
 */
export const RELAY_HEADERS = {
  /**
   * `peer` = this connection may relay client→client frames.
   * Anything else (or absent) = fan-out only, the historical behaviour of every
   * poker / retro / brain-chat / project room.
   */
  mode: 'x-bf-relay-mode',
  /** Stable identity of the connecting principal (`users.id`). */
  ref: 'x-bf-relay-ref',
  /** Display name, when the route already has one. Optional. */
  name: 'x-bf-relay-name',
  /** Seat kind — 'human' | 'cloud_agent' | 'host_agent'. */
  kind: 'x-bf-relay-kind',
} as const;

/** Connections that may relay peer frames declare themselves with this mode. */
export const RELAY_MODE_PEER = 'peer';

export interface RelayHeaderIdentity {
  ref: string;
  name?: string;
  kind?: string;
}

/** Read the identity the ROUTE asserted. Returns null for a fan-out connection. */
export function relayIdentityFromHeaders(headers: Headers): RelayHeaderIdentity | null {
  if (headers.get(RELAY_HEADERS.mode) !== RELAY_MODE_PEER) return null;
  const ref = (headers.get(RELAY_HEADERS.ref) ?? '').slice(0, 64);
  if (!ref) return null;
  return {
    ref,
    name: (headers.get(RELAY_HEADERS.name) ?? '').slice(0, 80) || undefined,
    kind: (headers.get(RELAY_HEADERS.kind) ?? '').slice(0, 32) || undefined,
  };
}
