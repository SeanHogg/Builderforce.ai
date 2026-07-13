/**
 * CeremonyRoomDO — a live multiplayer relay for a standup/planning "ceremony"
 * (the round-table surface). One DO instance per room, keyed `ceremony:<projectId>`
 * so a board's standup and planning share one room.
 *
 * Unlike {@link SessionRoomDO} (which only fans out server-pushed `changed`
 * frames), a ceremony needs CLIENT→CLIENT relay: presence (who is at the table),
 * cursor moves, and drag previews flow peer-to-peer. So this DO listens for
 * messages on each socket and relays them to every OTHER client.
 *
 * It stays deliberately stateless about the domain: the REST routes remain the
 * segment-scoped source of truth (auth, validation, persistence of task/sprint
 * mutations). After a client commits a mutation it sends `{type:"changed"}`,
 * which is relayed so peers re-fetch — no domain data is persisted here, so
 * nothing can leak across segments. Memory-only (no storage), like SessionRoomDO.
 *
 * Frame protocol (all JSON, `type` discriminator):
 *  - server→client on connect: `{type:"hello", id}` (the peer's assigned id)
 *  - client→server `{type:"join", name, kind, ref}` → relayed as `{type:"presence", action:"join", peer:{id,name,kind,ref}}` and the joiner is sent the current roster `{type:"roster", peers:[…]}`
 *  - client→server `{type:"cursor", x, y}` / `{type:"drag", …}` / `{type:"changed"}` → relayed verbatim to others, stamped with `from:<peerId>`
 *  - on disconnect: `{type:"presence", action:"leave", peer:{id}}` is broadcast
 */
interface Peer {
  ws: WebSocket;
  id: string;
  name: string;
  kind: string;
  ref: string;
}

export class CeremonyRoomDO implements DurableObject {
  // Required brand for the DurableObjectNamespace<T> generic constraint.
  declare readonly '__DURABLE_OBJECT_BRAND': never;

  private peers = new Map<WebSocket, Peer>();
  private seq = 0;

  constructor(private state: DurableObjectState, private env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') !== 'websocket') {
      // Internal broadcast trigger (parity with SessionRoomDO; lets a future
      // server-side path push `changed` without a connected client).
      if (request.method === 'POST' && url.pathname.endsWith('/broadcast')) {
        let frame = '{"type":"changed"}';
        try {
          const body = await request.text();
          if (body) frame = body;
        } catch { /* keep default */ }
        this.broadcast(frame, null);
        return new Response(null, { status: 204 });
      }
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    const id = `p${++this.seq}`;
    // Identity is filled in by the client's `join` frame; until then the peer is
    // anonymous but still receives relayed frames.
    const peer: Peer = { ws: server, id, name: '', kind: '', ref: '' };
    this.peers.set(server, peer);

    server.addEventListener('message', (ev) => this.onMessage(peer, ev));
    server.addEventListener('close', () => this.onClose(peer));
    server.addEventListener('error', () => this.onClose(peer));

    try { server.send(JSON.stringify({ type: 'hello', id })); } catch { /* ignore */ }

    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(peer: Peer, ev: MessageEvent): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch {
      return; // ignore non-JSON frames
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      peer.name = String(msg.name ?? '');
      peer.kind = String(msg.kind ?? '');
      peer.ref = String(msg.ref ?? '');
      // Send the joiner the current roster, then announce them to everyone else.
      try {
        peer.ws.send(JSON.stringify({ type: 'roster', peers: this.roster() }));
      } catch { /* ignore */ }
      this.broadcast(
        JSON.stringify({ type: 'presence', action: 'join', peer: this.publicPeer(peer) }),
        peer.ws,
      );
      return;
    }

    // All other frames (cursor, drag, changed, …) relay verbatim to OTHER
    // clients, stamped with the sender so the UI can attribute them.
    this.broadcast(JSON.stringify({ ...msg, from: peer.id }), peer.ws);
  }

  private onClose(peer: Peer): void {
    if (!this.peers.delete(peer.ws)) return;
    this.broadcast(
      JSON.stringify({ type: 'presence', action: 'leave', peer: { id: peer.id } }),
      peer.ws,
    );
  }

  private roster(): Array<ReturnType<CeremonyRoomDO['publicPeer']>> {
    return [...this.peers.values()].map((p) => this.publicPeer(p));
  }

  private publicPeer(p: Peer) {
    return { id: p.id, name: p.name, kind: p.kind, ref: p.ref };
  }

  /** Send `data` to every connected client except `except` (null = everyone). */
  private broadcast(data: string, except: WebSocket | null): void {
    for (const [ws] of this.peers) {
      if (ws === except) continue;
      try { ws.send(data); } catch { this.peers.delete(ws); }
    }
  }
}
