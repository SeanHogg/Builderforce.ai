/**
 * SessionRoomDO — a minimal WebSocket fan-out relay for collaborative sessions
 * (planning poker, retrospectives). One DO instance per room (keyed by
 * `poker:<sessionId>` / `retro:<retroId>`).
 *
 * It is deliberately stateless about the domain: the REST routes remain the
 * segment-scoped source of truth (auth, validation, persistence). After any
 * mutation those routes POST `/broadcast` to this DO, which pushes a small
 * `{ "type": "changed" }` frame to every connected client; clients then re-fetch
 * the session detail. This replaces client polling with server push while
 * reusing all the existing route logic — no domain data flows through the DO,
 * so there is nothing here that could leak across segments.
 */
export class SessionRoomDO implements DurableObject {
  // Required brand for the DurableObjectNamespace<T> generic constraint.
  declare readonly '__DURABLE_OBJECT_BRAND': never;

  private clients = new Set<WebSocket>();

  constructor(private state: DurableObjectState, private env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') !== 'websocket') {
      // Internal broadcast trigger from the REST routes.
      if (request.method === 'POST' && url.pathname.endsWith('/broadcast')) {
        let frame = '{"type":"changed"}';
        try {
          const body = await request.text();
          if (body) frame = body;
        } catch { /* keep default */ }
        this.broadcast(frame);
        return new Response(null, { status: 204 });
      }
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    this.clients.add(server);
    server.addEventListener('close', () => this.clients.delete(server));
    server.addEventListener('error', () => this.clients.delete(server));
    try { server.send('{"type":"connected"}'); } catch { /* ignore */ }

    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(data: string): void {
    for (const ws of [...this.clients]) {
      try { ws.send(data); } catch { this.clients.delete(ws); }
    }
  }
}
