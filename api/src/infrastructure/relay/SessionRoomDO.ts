import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import { CANVAS_PRESENCE_FRAME, canvasPresenceFrame } from '@builderforce/creation-canvas-contract';
import { relayIdentityFromHeaders } from '../../domain/shared/relayIdentity';
import { PeerRelay, type RelayPeer } from './peerRelay';

/**
 * SessionRoomDO — the WebSocket room for collaborative sessions (planning poker,
 * retrospectives, brain chats, project boards, and the Creation Canvas). One DO
 * instance per room, keyed by the caller (`poker:<id>` / `creation:<tenant>:<id>` / …).
 *
 * ── FAN-OUT (every room) ─────────────────────────────────────────────────────
 * The REST routes remain the segment-scoped source of truth (auth, validation,
 * persistence). After any mutation those routes POST `/broadcast` here and a small
 * `{"type":"changed"}` frame goes to every connected client, which then re-fetches.
 * That reuses all the existing route logic and keeps the room ignorant of the
 * domain: no domain data is persisted or interpreted here.
 *
 * ── PEER RELAY (canvas rooms only) ───────────────────────────────────────────
 * A pointer cannot ride the fan-out. Remote cursors used to arrive on the canvas's
 * 8-second `/presence` REST poll — correct, and up to eight seconds behind where
 * the collaborator actually was, with a `creation_session_members.cursor` write on
 * every tick to pay for it.
 *
 * A connection the ROUTE marks `x-bf-relay-mode: peer` may therefore send frames
 * that are relayed to the other peers in the room. Three properties keep that from
 * re-opening what the fan-out design closed:
 *
 *  1. **Identity is the route's, not the client's.** `x-bf-relay-ref` is written by
 *     `relayToRoom` after `requireSession`, and the client's own copy of the header
 *     is stripped. A socket cannot move somebody else's cursor.
 *  2. **One frame type, one shape.** Only `canvas.presence` relays, and what goes
 *     out is `canvasPresenceFrame`'s OUTPUT — cursor, viewport, typing — not the
 *     client's input. A field that is not in the contract cannot cross, so the
 *     "nothing here could leak across segments" property is enforced by shape
 *     rather than by trust.
 *  3. **A per-peer rate limit.** Pointer frames arrive at pointer speed; the token
 *     bucket in {@link PeerRelay} bounds what one socket can make the room fan out.
 *
 * Rooms that never opt in behave exactly as before: their sockets have no message
 * listener at all.
 */
export class SessionRoomDO implements DurableObject {
  // Required brand for the DurableObjectNamespace<T> generic constraint.
  declare readonly '__DURABLE_OBJECT_BRAND': never;

  /** Fan-out members. Every socket is here, whether or not it may relay. */
  private clients = new Set<WebSocket>();

  /**
   * The peer half. Only sockets the route admitted as peers are registered, so a
   * poker room's relay stays empty and its `announce*` calls never fire.
   */
  private relay = new PeerRelay({
    allowFrames: [CANVAS_PRESENCE_FRAME],
    sanitize: (frame) => canvasPresenceFrame(frame),
    // Both ids are stamped: `from` attributes the SOCKET (two tabs, one person),
    // `userId` attributes the PERSON, which is what the roster is keyed by.
    stamp: (peer) => ({ type: CANVAS_PRESENCE_FRAME, from: peer.id, userId: peer.ref }),
    // A pointer at 20/s with headroom for a burst after a stall.
    framesPerSecond: 30,
    burst: 60,
    maxFrameChars: 512,
  });

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
        } catch (error) { /* keep default */
          reportCaughtError(error, { source: "infrastructure/relay/SessionRoomDO.ts", operation: "fetch" }, { env: this.env, waitUntil: (task) => this.state.waitUntil(task) });
        }
        this.broadcast(frame);
        return new Response(null, { status: 204 });
      }
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    this.clients.add(server);

    // The route decides whether this socket may relay; the client cannot ask.
    const identity = relayIdentityFromHeaders(request.headers);
    const peer = identity ? this.relay.add(server, { ...identity, kind: identity.kind ?? 'human' }) : null;

    server.addEventListener('close', () => this.drop(server));
    server.addEventListener('error', () => this.drop(server));
    if (peer) server.addEventListener('message', (event: MessageEvent) => this.onPeerFrame(peer, event));

    // The same `connected` frame for both kinds of connection. A peer does NOT get
    // a roster here: identity and membership are the presence poll's to answer, and
    // a second answer from the relay is a second thing that can disagree with it.
    try {
      server.send('{"type":"connected"}');
    } catch (error) { /* ignore */
      reportCaughtError(error, { source: "infrastructure/relay/SessionRoomDO.ts", operation: "fetch" }, { env: this.env, waitUntil: (task) => this.state.waitUntil(task) });
    }
    if (peer) this.relay.announceJoin(peer);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Relay one peer frame. A refusal (malformed, disallowed, rate-limited) is silent. */
  private onPeerFrame(peer: RelayPeer, event: MessageEvent): void {
    this.relay.relay(peer, typeof event.data === 'string' ? event.data : null);
  }

  private drop(ws: WebSocket): void {
    this.clients.delete(ws);
    const peer = this.relay.remove(ws);
    // A cursor must not outlive its owner: peers drop the pointer on `leave`.
    if (peer) this.relay.announceLeave(peer);
  }

  private broadcast(data: string): void {
    for (const ws of [...this.clients]) {
      try { ws.send(data); } catch { this.drop(ws); }
    }
  }
}
