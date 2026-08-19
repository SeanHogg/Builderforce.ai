import type { Context } from 'hono';
import type { HonoEnv } from '../../env';
import { RELAY_HEADERS, RELAY_MODE_PEER, type RelayHeaderIdentity } from '../../domain/shared/relayIdentity';

/**
 * Shared WebSocket-upgrade → Durable Object relay. The poker, retro, ceremony,
 * canvas and project "live rooms" were byte-identical boilerplate: reject a
 * non-WS request (426), 503 when the DO binding is absent, else hand the request
 * to the named room DO, with the authed REST routes staying the source of truth.
 *
 * `peer` is what makes a room a CLIENT→CLIENT relay rather than a fan-out. A DO
 * sees a socket, not a session, so the only thing that can tell it who is on the
 * other end is the route that already ran `requireSession`. Passing an identity
 * here marks the connection relay-capable and stamps that identity onto every
 * frame it sends.
 *
 * THE HEADERS ARE ALWAYS REWRITTEN, including when there is no identity. A client
 * that sets `x-bf-relay-ref` itself would otherwise be handing the DO a forged
 * principal, which on the canvas means moving somebody else's cursor; stripping
 * unconditionally means a forged header cannot survive the hop even on a route
 * that never opts in.
 *
 * Declared `async` on purpose so the handler's return type is uniformly
 * `Promise<Response>`. The inline version mixed a synchronous `c.text(...)`
 * (`Response`) with the async `.fetch(...)` (`Promise<Response>`); that union
 * tripped Hono's `.get()` overload resolution (TS2769 — it pins the return
 * generic to the sync `Response` and then rejects the `Promise` member).
 */
export async function relayToRoom(
  c: Context<HonoEnv>,
  binding: DurableObjectNamespace | undefined,
  roomName: string,
  peer?: RelayHeaderIdentity | null,
): Promise<Response> {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected WebSocket', 426);
  if (!binding) return c.text('Realtime unavailable', 503);

  const headers = new Headers(c.req.raw.headers);
  for (const header of Object.values(RELAY_HEADERS)) headers.delete(header);
  if (peer?.ref) {
    headers.set(RELAY_HEADERS.mode, RELAY_MODE_PEER);
    headers.set(RELAY_HEADERS.ref, peer.ref);
    headers.set(RELAY_HEADERS.kind, peer.kind ?? 'human');
    if (peer.name) headers.set(RELAY_HEADERS.name, peer.name);
  }

  return binding.get(binding.idFromName(roomName)).fetch(new Request(c.req.raw, { headers }));
}
