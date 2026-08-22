import { createDurableErrorReporter, type DurableErrorReporter } from '../../application/observability/durableErrorReporter';
import { PeerRelay, type RelayPeer } from './peerRelay';
import { relayIdentityFromHeaders, type RelayHeaderIdentity } from '../../domain/shared/relayIdentity';

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
 * IDENTITY IS ASSERTED BY THE ROUTE, not declared by the client.
 *
 * A Durable Object sees a socket, never a session: it holds no JWT and no secret to
 * verify one against, so "re-verify the token on every frame" is not something it can
 * do. What it CAN stop doing is trusting the browser. The seat name/kind/ref used to come
 * straight from the client's `join` frame, so anyone able to open the socket could sit at
 * the round table as anyone else, and every relayed cursor and drag carried that forged
 * attribution. The authed route now stamps the caller's identity into the relay headers
 * (stripped-then-set, so a client copy cannot survive the hop) and this class prefers it
 * over anything the join frame says. A connection with NO asserted identity — only
 * possible if the route forgot to pass one — falls back to the old self-declared
 * behaviour rather than dropping the socket, so a mis-wired route degrades instead of
 * breaking the surface.
 *
 * Frame protocol (all JSON, `type` discriminator):
 *  - server→client on connect: `{type:"hello", id}` (the peer's assigned id)
 *  - client→server `{type:"join", name, kind, ref}` → relayed as `{type:"presence", action:"join", peer:{id,name,kind,ref}}` and the joiner is sent the current roster `{type:"roster", peers:[…]}`
 *  - client→server `{type:"cursor", x, y}` / `{type:"drag", …}` → relayed verbatim to others, stamped with `from:<peerId>`
 *  - `{type:"changed"}` is SERVER-ONLY: produced by the internal `POST …/broadcast`, and DROPPED when a client sends one
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
  private relay = new PeerRelay({
    framesPerSecond: 40,
    burst: 80,
    // A WebRTC offer/answer carries a full SDP, which is routinely several KB and
    // occasionally tens of them (many codecs, many candidates). The cap is a
    // sanity bound on one frame, not a protocol opinion — set below it and the
    // symptom is a call that silently never connects.
    maxFrameChars: 65_536,
  });

  /**
   * The route-asserted identity per socket. Keyed by peer id rather than stored on the
   * peer so `PeerRelay` stays the shared, surface-agnostic primitive it is.
   */
  private asserted = new Map<string, RelayHeaderIdentity>();

  /** Bound once here so no call site can forget the runtime override. */
  private readonly reportError: DurableErrorReporter;

  constructor(private state: DurableObjectState, private env: unknown) {
    this.reportError = createDurableErrorReporter('infrastructure/relay/CeremonyRoomDO.ts', env, state);
  }

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
          this.reportError(error, { operation: "fetch" });
        }
        this.relay.broadcast(frame);
        return new Response(null, { status: 204 });
      }
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    // The identity the ROUTE authenticated, if it passed one. Read before the socket is
    // registered so the first `join` frame already resolves against it.
    const identity = relayIdentityFromHeaders(request.headers);
    const peer = this.relay.add(server);
    if (identity) this.asserted.set(peer.id, identity);

    server.addEventListener('message', (ev) => this.onMessage(peer, ev));
    server.addEventListener('close', () => this.onClose(peer));
    server.addEventListener('error', () => this.onClose(peer));

    try { server.send(JSON.stringify({ type: 'hello', id: peer.id })); } catch (error) { /* ignore */
      this.reportError(error, { operation: "fetch" });
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

    // `changed` IS A SERVER SIGNAL. It used to be relayed verbatim from whichever client
    // had just committed a mutation, which made the refresh fan-out depend on that client
    // still being connected and still choosing to send it — so a mutation by the AI
    // Manager, a cron sweep or a second tab reached nobody — and let any connected client
    // fabricate a refresh storm for the whole room. It now arrives only through the
    // internal `POST /broadcast` above (`broadcastCeremonyChanged`), and a client frame
    // claiming to be one is dropped.
    if (msg.type === 'changed') return;

    if (msg.type === 'join') {
      // The route's assertion wins over anything the client declared. See the class doc.
      const claimed = this.asserted.get(peer.id);
      this.relay.identify(peer, claimed
        ? { name: claimed.name ?? String(msg.name ?? ''), kind: claimed.kind ?? 'human', ref: claimed.ref }
        : { name: String(msg.name ?? ''), kind: String(msg.kind ?? ''), ref: String(msg.ref ?? '') });
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
    this.asserted.delete(peer.id);
    if (!this.relay.remove(peer.ws)) return;
    this.relay.announceLeave(peer);
  }
}
