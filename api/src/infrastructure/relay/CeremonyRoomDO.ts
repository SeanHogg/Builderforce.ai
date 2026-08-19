import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { PeerRelay, type RelayPeer } from './peerRelay';

/**
 * CeremonyRoomDO — a live multiplayer relay for a standup/planning "ceremony"
 * (the round-table surface). One DO instance per room, keyed `ceremony:<projectId>`
 * so a board's standup and planning share one room.
 *
 * Unlike a fan-out-only {@link SessionRoomDO} room, a ceremony needs CLIENT→CLIENT
 * relay: presence (who is at the table), cursor moves, and drag previews flow
 * peer-to-peer. The registry, roster, rate limit and fan-out that needs are
 * {@link PeerRelay}, shared with the guest room and the canvas room — this class is
 * now only the ceremony's own protocol decisions.
 *
 * It stays deliberately stateless about the domain: the REST routes remain the
 * segment-scoped source of truth (auth, validation, persistence of task/sprint
 * mutations). After a client commits a mutation it sends `{type:"changed"}`,
 * which is relayed so peers re-fetch — no domain data is persisted here, so
 * nothing can leak across segments. Memory-only (no storage).
 *
 * Identity is still declared by the client's `join` frame here, unlike the canvas
 * room where the route asserts it: a ceremony seat is a self-declared name at a
 * round table, and the surface shows the roster to the same people who can already
 * read the board.
 *
 * Frame protocol (all JSON, `type` discriminator):
 *  - server→client on connect: `{type:"hello", id}` (the peer's assigned id)
 *  - client→server `{type:"join", name, kind, ref}` → relayed as `{type:"presence", action:"join", peer:{id,name,kind,ref}}` and the joiner is sent the current roster `{type:"roster", peers:[…]}`
 *  - client→server `{type:"cursor", x, y}` / `{type:"drag", …}` / `{type:"changed"}` → relayed verbatim to others, stamped with `from:<peerId>`
 *  - on disconnect: `{type:"presence", action:"leave", peer:{id}}` is broadcast
 */
export class CeremonyRoomDO implements DurableObject {
  // Required brand for the DurableObjectNamespace<T> generic constraint.
  declare readonly '__DURABLE_OBJECT_BRAND': never;

  /**
   * Open frame set on purpose: a ceremony relays cursors, drag previews, `changed`
   * signals AND the WebRTC offer/answer/ICE traffic of the meeting surface, which
   * an allow-list would have to be extended for every time signaling changed. The
   * rate limit still applies, so "open" is not "unbounded".
   */
  private relay = new PeerRelay({ framesPerSecond: 40, burst: 80 });

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
        } catch (error) { /* keep default */
          reportCaughtError(error, { source: "infrastructure/relay/CeremonyRoomDO.ts", operation: "fetch" }, { env: this.env, waitUntil: (task) => this.state.waitUntil(task) });
        }
        this.relay.broadcast(frame);
        return new Response(null, { status: 204 });
      }
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    // Identity is filled in by the client's `join` frame; until then the peer is
    // anonymous but still receives relayed frames.
    const peer = this.relay.add(server);

    server.addEventListener('message', (ev) => this.onMessage(peer, ev));
    server.addEventListener('close', () => this.onClose(peer));
    server.addEventListener('error', () => this.onClose(peer));

    try { server.send(JSON.stringify({ type: 'hello', id: peer.id })); } catch (error) { /* ignore */
      reportCaughtError(error, { source: "infrastructure/relay/CeremonyRoomDO.ts", operation: "fetch" }, { env: this.env, waitUntil: (task) => this.state.waitUntil(task) });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(peer: RelayPeer, ev: MessageEvent): void {
    if (typeof ev.data !== 'string') return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(ev.data) as Record<string, unknown>;
    } catch {
      return; // ignore non-JSON frames
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      this.relay.identify(peer, { name: String(msg.name ?? ''), kind: String(msg.kind ?? ''), ref: String(msg.ref ?? '') });
      // Send the joiner the current roster, then announce them to everyone else.
      this.relay.send(peer, { type: 'roster', peers: this.relay.roster() });
      this.relay.announceJoin(peer);
      return;
    }

    // All other frames (cursor, drag, changed, …) relay verbatim to OTHER
    // clients, stamped with the sender so the UI can attribute them.
    this.relay.relay(peer, ev.data);
  }

  private onClose(peer: RelayPeer): void {
    if (!this.relay.remove(peer.ws)) return;
    this.relay.announceLeave(peer);
  }
}
