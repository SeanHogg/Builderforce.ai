import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { createDurableErrorReporter, type DurableErrorReporter } from '../../application/observability/durableErrorReporter';
import { createThrottledReporter, type ThrottledReporter } from '../../application/observability/throttledReporter';
import { relayIdentityFromHeaders } from '../../domain/shared/relayIdentity';
import {
  carriesDocumentData, encodeAwareness, encodeSyncStep1, encodeUpdate, MESSAGE_AWARENESS, MESSAGE_SYNC, toBytes,
} from './collabFrames';
import { CLOSE_RATE_LIMITED, COLLAB_FRAME_RATE, FrameBudgets } from './collabFrameBudget';
import { isEphemeralJsonFrame, relayableJson, type JsonFrame } from './collabJsonRelay';
import { CLOSE_TOO_LARGE, MAX_STATE_BYTES, StateAdmission } from './collabRoomAdmission';
import { RoomPersister } from './collabRoomPersister';

/**
 * CollaborationRoomDO — a hibernation-WebSocket Durable Object for real-time co-editing
 * (Yjs) and shared terminals.
 *
 * ── WHY IT LIVES IN THE API WORKER ───────────────────────────────────────────────
 * It used to live in `worker/`, a second Worker script that has never been deployed.
 * That made "real-time co-editing" permanently one operator action away from existing:
 * a deploy target nobody deploys, plus an `NEXT_PUBLIC_COLLAB_WS_URL` nobody sets, and
 * a client hook that stayed inert until both happened. Neither was buying anything —
 * the api Worker already hosts eight Durable Objects and already terminates every other
 * WebSocket the product opens.
 *
 * Moving it here means the room ships with the ordinary api release and the browser
 * DERIVES its URL from the API origin it is already talking to. The env var survives
 * only as an override for a self-hoster running collab somewhere else.
 *
 * It also gained the thing the standalone worker never had: AUTH. `worker/`'s
 * `/api/collab/:sessionId/ws` route was open to the internet — any room name, no token,
 * no tenant check. Here the upgrade goes through `authMiddleware` and a per-scope
 * authorization check (`collabScopes.ts`) before `relayToRoom` ever names an instance,
 * and the participant's identity is stamped by the ROUTE rather than read from a
 * forgeable query parameter.
 *
 * ── WHAT CHANGED, AND WHY IT MATTERED ────────────────────────────────────────────
 * This used to be a stateless binary relay: it forwarded Yjs updates between peers and
 * held no server `Y.Doc`. That is enough for two people who join at the same moment and
 * wrong for everybody else, because a Yjs client that connects to a relay never completes
 * a sync handshake — nobody answers its SyncStep1 — so a LATE JOINER adopts an empty
 * document and then merges its emptiness into the room. The client hook was written
 * defensively around exactly that (`shouldSeed` picks one client by lowest user id and
 * only after a settle window), which is a workaround for a missing server, not a design.
 *
 * The room is now AUTHORITATIVE. It holds the `Y.Doc`, answers the handshake, applies
 * every update to its own copy, and persists that copy to `state.storage` — so a room
 * that evicts and comes back, or a person who opens the document an hour later, gets the
 * document rather than a blank one.
 *
 * ── HIBERNATION, AND THE BUG IT WAS HIDING ───────────────────────────────────────
 * Sessions used to live in an instance `Map`. With `state.acceptWebSocket` the runtime is
 * free to EVICT the object between messages and rebuild it on the next one — at which
 * point that Map is empty, `webSocketMessage` finds no session, and the message is
 * silently dropped. It works in a test and in a fast local demo and fails on an idle
 * connection, which is the worst combination of properties a defect can have.
 *
 * Session identity now rides on the socket itself (`serializeAttachment`), and the roster
 * is always read from `state.getWebSockets()`. Nothing survives only in memory.
 *
 * ── THE TWO PROTOCOLS, DELIBERATELY BOTH ─────────────────────────────────────────
 * BINARY frames are the y-websocket protocol (`0` = sync, `1` = awareness) — what
 * `y-websocket`'s `WebsocketProvider` speaks, and what the doc editor uses. JSON frames
 * are the room's own presence/terminal messages, which predate this and are used by
 * surfaces that carry no `Y.Doc` at all. Collapsing them into one would mean either
 * teaching the terminal to speak Yjs or teaching the editor to speak JSON, and both are
 * more work than a `typeof message` check.
 *
 * The Yjs assertions in the companion test run against the REAL `yjs` and `y-protocols`
 * packages, so the bytes asserted here are the bytes a `y-websocket` client expects.
 */

/* Frames: `collabFrames.ts`. Storage layout: `collabRoomStorage.ts`. Debounced load/save: `collabRoomPersister.ts`.
 * The state-size ceiling: `collabRoomAdmission.ts`. */
export { encodeAwareness, encodeSyncStep1, encodeUpdate };
export { CLOSE_TOO_LARGE, MAX_STATE_BYTES };

/** A persist/oversize failure is reported at most this often per room; it repeats on every save otherwise. */
const ERROR_REPORT_INTERVAL_MS = 5 * 60_000;

/** How long to coalesce writes before persisting (the trade is explained on `RoomPersister`). */
const PERSIST_DEBOUNCE_MS = 2_000;

export { CLOSE_RATE_LIMITED, COLLAB_FRAME_RATE };

interface SessionInfo {
  /** `users.id`, asserted by the authed route. Never read from the query string. */
  userId: string;
  name: string;
  color: string;
  /**
   * The AWARENESS client ids this socket controls.
   *
   * A Yjs client id is not the user id and is not knowable at connect time — it is minted
   * by the client doc and first seen in an awareness frame. It is recorded here, on the
   * socket, so a disconnect can retire exactly the cursors that left. Keeping it in an
   * instance Map instead would lose it to a hibernation, and the room would then hold
   * ghost participants until the 30-second awareness timeout swept them.
   */
  clientIds?: number[];
}

export class CollaborationRoomDO implements DurableObject {
  // Required brand for the DurableObjectNamespace<T> generic constraint.
  declare readonly '__DURABLE_OBJECT_BRAND': never;

  private state: DurableObjectState;
  private doc: Y.Doc;
  private awareness: awarenessProtocol.Awareness;
  private readonly persister: RoomPersister;
  private readonly admission = new StateAdmission();
  private readonly reportThrottled: ThrottledReporter;
  private readonly budgets = new FrameBudgets();
  /** Bound once here so no call site can forget the runtime override. */
  private readonly reportError: DurableErrorReporter;

  constructor(state: DurableObjectState, env?: unknown) {
    this.state = state;
    this.reportError = createDurableErrorReporter('infrastructure/relay/CollaborationRoomDO.ts', env, state);
    this.reportThrottled = createThrottledReporter(this.reportError, ERROR_REPORT_INTERVAL_MS);
    this.doc = new Y.Doc();
    this.persister = new RoomPersister(this.doc, state.storage, this.admission, this.reportThrottled, PERSIST_DEBOUNCE_MS);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    // The local awareness client is the SERVER, which has no cursor and must never appear
    // in anybody's peer list. Removing its own state keeps the room's roster equal to the
    // set of real participants.
    this.awareness.setLocalState(null);

    // Loaded inside `blockConcurrencyWhile` so no message can be handled against an empty
    // document: a client whose SyncStep1 arrived first would otherwise be told the room is
    // blank and would helpfully overwrite it.
    void this.state.blockConcurrencyWhile?.(async () => {
      await this.persister.load();
    });

    this.doc.on('update', () => this.persister.schedule());

    /**
     * ONE awareness fan-out, here rather than at each call site.
     *
     * Two things happen on every awareness change and both used to have to be remembered
     * separately: record which socket owns the client ids that just appeared (so a
     * disconnect can retire exactly those cursors), and tell everybody else. Doing it on
     * the event means a retirement issued by `removeAwarenessStates` — which no socket
     * sent — reaches the room the same way a live update does, instead of being the one
     * change nobody broadcasts.
     *
     * `origin` is whatever was passed to `applyAwarenessUpdate`: a `WebSocket` for a real
     * frame, a string for a server-issued retirement. A retirement has no sender, so it
     * goes to everyone.
     */
    this.awareness.on('update', (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      const sender = isWebSocket(origin) ? origin : null;
      if (sender && added.length) this.rememberAwarenessClients(sender, added);
      if (removed.length) {
        const changed = [...added, ...updated, ...removed];
        this.broadcastToAll(encodeAwareness(this.awareness, changed));
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();

    // `acceptWebSocket`, not `accept()`: this is a HIBERNATABLE socket, which is
    // the whole reason session state rides on the socket rather than in a field.
    this.state.acceptWebSocket(server);

    // WHO, decided by the route. `relayToRoom` strips any copy the client sent and
    // writes the identity it resolved from the session, so a socket cannot author a
    // frame as somebody else — the same rule SessionRoomDO's peer relay runs on. The
    // display name and colour are cosmetic and may still come off the query string;
    // the id may not.
    const identity = relayIdentityFromHeaders(request.headers);
    const userId = identity?.ref ?? `guest-${this.state.id.toString().slice(0, 8)}`;
    const session: SessionInfo = {
      userId,
      name: (url.searchParams.get('name') || identity?.name || `User ${userId.slice(0, 6)}`).slice(0, 80),
      color: (url.searchParams.get('color') || '#4f46e5').slice(0, 32),
    };
    // ON THE SOCKET, not in a Map: the object may be evicted between messages, and a
    // roster that lives only in memory comes back empty.
    server.serializeAttachment(session);

    // The handshake, opened by the SERVER. `y-websocket` clients also send their own
    // SyncStep1, but a room that waits to be asked cannot tell a new client about a
    // document nobody is currently editing.
    this.send(server, encodeSyncStep1(this.doc));
    const states = this.awareness.getStates();
    if (states.size > 0) {
      this.send(server, encodeAwareness(this.awareness, Array.from(states.keys())));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    try {
      const session = this.sessionFor(ws);
      if (!session) return;

      if (typeof message !== 'string') {
        const bytes = toBytes(message);
        if (!this.budgets.take(ws)) {
          this.refuse(ws, bytes[0] === MESSAGE_AWARENESS);
          return;
        }
        this.handleBinary(ws, bytes);
        return;
      }

      const data = JSON.parse(message) as JsonFrame;
      if (!this.budgets.take(ws)) {
        this.refuse(ws, isEphemeralJsonFrame(data));
        return;
      }

      const relayed = relayableJson(data, message, session);
      if (relayed !== null) this.broadcast(ws, relayed);
    } catch (error) {
      this.reportError(error, { operation: 'webSocketMessage' });
    }
  }

  /**
   * An over-budget frame. A cursor or presence frame is dropped — the next heartbeat
   * corrects it. A document or terminal frame may NOT be dropped: the sender believes it
   * was delivered, so the room would silently fork. The socket is closed instead, and the
   * client reconnects and re-syncs.
   */
  private refuse(ws: WebSocket, ephemeral: boolean, code = CLOSE_RATE_LIMITED, reason = 'rate limited'): void {
    if (ephemeral) return;
    try {
      ws.close(code, reason);
    } catch (error) {
      this.reportError(error, { operation: 'refuse' });
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.dropAwareness(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.dropAwareness(ws);
  }

  // -------------------------------------------------------------------------
  // The y-websocket protocol
  // -------------------------------------------------------------------------

  /**
   * One binary frame.
   *
   * SYNC is answered rather than relayed: `readSyncMessage` applies a step to the SERVER's
   * doc and writes the reply the sender needs into `encoder`. An update that changed
   * anything is then broadcast, because the other participants are not party to this
   * exchange and would otherwise diverge until their next edit.
   */
  private handleBinary(ws: WebSocket, bytes: Uint8Array): void {
    const decoder = decoding.createDecoder(bytes);
    const messageType = decoding.readVarUint(decoder);

    if (messageType === MESSAGE_SYNC) {
      // Refused BEFORE it is applied (see `StateAdmission`), and closed like a flood, so the
      // sender re-syncs from the room rather than believing the update was kept.
      if (carriesDocumentData(bytes) && !this.admission.admit(bytes.byteLength)) {
        this.reportThrottled('oversize', new Error('collaboration update refused: room state would exceed the hard cap'), {
          operation: 'handleBinary',
          level: 'warning',
          context: { logMessage: '[CollaborationRoomDO] refused an update past the state cap', details: this.admission.details(bytes.byteLength) },
        });
        this.refuse(ws, false, CLOSE_TOO_LARGE, 'room state too large');
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      const before = Y.encodeStateVector(this.doc);
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, null);
      // `length > 1` and not `> 0`: the message type byte is always written, so an
      // encoder holding only that is an empty reply, and sending it makes every
      // no-op sync step round-trip a frame.
      if (encoding.length(encoder) > 1) this.send(ws, encoding.toUint8Array(encoder));

      const diff = Y.encodeStateAsUpdate(this.doc, before);
      // A two-byte update is Yjs's encoding of "nothing changed".
      if (diff.length > 2) this.broadcast(ws, encodeUpdate(diff));
      return;
    }

    if (messageType === MESSAGE_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder);
      // Applied to the room's own Awareness — not merely relayed — so a client that joins
      // between two heartbeats sees who is already here instead of waiting up to the
      // 15-second awareness interval for the room to look populated.
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, ws);
      this.broadcast(ws, bytes);
    }
  }

  /**
   * Retire a departed participant's awareness state, so their cursor and name leave every
   * other client immediately rather than timing out thirty seconds later.
   *
   * `removeAwarenessStates` broadcasts the retirement to the room itself through the
   * awareness `update` listener registered in the constructor, so there is no second
   * broadcast here — one path out.
   */
  private dropAwareness(ws: WebSocket): void {
    const session = this.sessionFor(ws);
    const clientIds = session?.clientIds ?? [];
    if (clientIds.length) {
      awarenessProtocol.removeAwarenessStates(this.awareness, clientIds, 'connection closed');
    }
  }

  /**
   * Record which awareness clients a socket controls, as they appear.
   *
   * Read off the protocol's own `update` event rather than reaching into `Awareness`
   * internals: the event already reports exactly which client ids an update added, and its
   * `origin` is the socket we handed to `applyAwarenessUpdate`. A private field would be a
   * second answer that a y-protocols release is free to rename.
   */
  private rememberAwarenessClients(ws: WebSocket, added: readonly number[]): void {
    if (!added.length) return;
    const session = this.sessionFor(ws);
    if (!session) return;
    const clientIds = [...new Set([...(session.clientIds ?? []), ...added])];
    try {
      ws.serializeAttachment({ ...session, clientIds });
    } catch (error) {
      // A socket that will not take an attachment is closing; the timeout sweeps it.
      this.reportError(error, { operation: 'rememberAwarenessClients' });
    }
  }

  // -------------------------------------------------------------------------
  // Roster
  // -------------------------------------------------------------------------

  /** Read straight off the socket. See the header: an in-memory roster comes back empty
   *  after a hibernation, and every message on that connection is then dropped. */
  private sessionFor(ws: WebSocket): SessionInfo | null {
    try {
      return (ws.deserializeAttachment() as SessionInfo | null) ?? null;
    } catch (error) {
      this.reportError(error, { operation: 'sessionFor' });
      return null;
    }
  }

  private send(ws: WebSocket, payload: Uint8Array | string): void {
    try {
      if (ws.readyState === WebSocket.READY_STATE_OPEN) ws.send(payload as never);
    } catch (error) {
      // A socket that refuses a send is already gone; the close handler cleans it up.
      this.reportError(error, { operation: 'send' });
    }
  }

  private broadcast(sender: WebSocket, message: string | Uint8Array): void {
    for (const ws of this.state.getWebSockets()) {
      if (ws !== sender) this.send(ws, message);
    }
  }

  /** Everybody, including whoever caused it. Used for a change the SERVER originated — a
   *  retirement issued on disconnect has no sender to exclude. */
  private broadcastToAll(message: string | Uint8Array): void {
    for (const ws of this.state.getWebSockets()) this.send(ws, message);
  }
}

/** Is this the origin of a real client frame, or a server-issued reason string?
 *  Structural rather than `instanceof`: the Workers `WebSocket` global is not the one a
 *  unit test stubs, and an origin that fails the check is simply treated as serverside. */
function isWebSocket(value: unknown): value is WebSocket {
  return !!value && typeof value === 'object' && typeof (value as { send?: unknown }).send === 'function';
}
