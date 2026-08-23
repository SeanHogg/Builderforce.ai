import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { createDurableErrorReporter, type DurableErrorReporter } from '../../application/observability/durableErrorReporter';
import { relayIdentityFromHeaders } from '../../domain/shared/relayIdentity';

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

/** y-websocket message types. Two, and they are the whole protocol. */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/** Storage key for the persisted document state. Versioned so a future encoding change
 *  can be told apart from a document that simply has not been written yet. */
const DOC_KEY = 'ydoc:v1';

/**
 * How long to coalesce writes before persisting.
 *
 * Every keystroke is an update, and persisting each one would put a storage write on the
 * critical path of typing. Persisting NEVER would mean a room that evicts loses whatever
 * arrived since the last natural pause. A short debounce is the whole trade: at most this
 * many milliseconds of typing is at risk, and only if the object is evicted inside the
 * window, and only if every participant also disconnected — a connected peer still holds
 * the state and re-syncs it.
 */
const PERSIST_DEBOUNCE_MS = 2_000;

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
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bound once here so no call site can forget the runtime override. */
  private readonly reportError: DurableErrorReporter;

  constructor(state: DurableObjectState, env?: unknown) {
    this.state = state;
    this.reportError = createDurableErrorReporter('infrastructure/relay/CollaborationRoomDO.ts', env, state);
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    // The local awareness client is the SERVER, which has no cursor and must never appear
    // in anybody's peer list. Removing its own state keeps the room's roster equal to the
    // set of real participants.
    this.awareness.setLocalState(null);

    // Loaded inside `blockConcurrencyWhile` so no message can be handled against an empty
    // document: a client whose SyncStep1 arrived first would otherwise be told the room is
    // blank and would helpfully overwrite it.
    void this.state.blockConcurrencyWhile?.(async () => {
      const stored = await this.state.storage?.get<ArrayBuffer | Uint8Array>(DOC_KEY);
      if (stored) Y.applyUpdate(this.doc, toBytes(stored));
    });

    this.doc.on('update', () => this.schedulePersist());

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

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

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
        this.handleBinary(ws, toBytes(message));
        return;
      }

      const data = JSON.parse(message) as { type: string; [key: string]: unknown };

      switch (data.type) {
        case 'yjs-update':
          // The legacy JSON envelope. Relayed rather than applied: it carries no agreed
          // encoding for the update payload, so the room cannot merge it into its own doc
          // without guessing. Clients on the binary protocol — every Yjs client — get the
          // authoritative path above.
          this.broadcast(ws, message);
          break;
        case 'presence':
          this.broadcast(ws, JSON.stringify({
            ...data,
            type: 'presence',
            userId: session.userId,
            name: session.name,
            color: session.color,
          }));
          break;
        case 'terminal-input':
          this.broadcast(ws, JSON.stringify({
            type: 'terminal-input',
            userId: session.userId,
            data: data.data,
          }));
          break;
        case 'terminal-output':
          this.broadcast(ws, JSON.stringify({ type: 'terminal-output', data: data.data }));
          break;
      }
    } catch (error) {
      this.reportError(error, { operation: 'webSocketMessage' });
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
    } catch {
      // A socket that will not take an attachment is closing; the timeout sweeps it.
    }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  private async persist(): Promise<void> {
    try {
      await this.state.storage?.put(DOC_KEY, Y.encodeStateAsUpdate(this.doc));
    } catch (error) {
      // A failed write must not take the room down: the document is still correct in
      // memory and in every connected client, and the next update reschedules.
      this.reportError(error, { operation: 'persist' });
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
    } catch {
      return null;
    }
  }

  private send(ws: WebSocket, payload: Uint8Array | string): void {
    try {
      if (ws.readyState === WebSocket.READY_STATE_OPEN) ws.send(payload as never);
    } catch {
      // A socket that refuses a send is already gone; the close handler cleans it up.
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

// ---------------------------------------------------------------------------
// Frame encoders — module scope, so the tests can build the same bytes a client would
// ---------------------------------------------------------------------------

/** The message that ASKS for what the receiver is missing. Sent to every new connection. */
export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A document update, wrapped in the sync envelope. */
export function encodeUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** The current awareness state of the named clients. */
export function encodeAwareness(awareness: awarenessProtocol.Awareness, clients: number[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, clients));
  return encoding.toUint8Array(encoder);
}

/** Workers hand binary frames over as `ArrayBuffer`; `y-protocols` wants a `Uint8Array`.
 *  One conversion, so no call site has to remember which it is holding. */
function toBytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}
