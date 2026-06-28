import type { Context } from 'hono';
import type { HonoEnv } from '../../env';

/**
 * Shared WebSocket-upgrade → Durable Object fan-out relay. The poker, retro,
 * ceremony and project "live rooms" were byte-identical boilerplate: reject a
 * non-WS request (426), 503 when the DO binding is absent, else hand the raw
 * request to the named room DO — a dumb fan-out relay, with the authed REST
 * routes staying the source of truth (no domain data flows through the DO).
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
): Promise<Response> {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected WebSocket', 426);
  if (!binding) return c.text('Realtime unavailable', 503);
  return binding.get(binding.idFromName(roomName)).fetch(c.req.raw);
}
