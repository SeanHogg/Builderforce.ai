import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { CollaborationRoom, encodeSyncStep1, encodeUpdate, encodeAwareness } from './CollaborationRoom';

/**
 * The room is now AUTHORITATIVE, and these tests are written against that rather than
 * against a relay.
 *
 * The old suite reached into a private `sessions` Map to inject participants — which is
 * how it kept passing while the production object dropped every message after a
 * hibernation: the Map it asserted on is exactly the state the runtime is free to throw
 * away. Sessions now ride on the socket (`serializeAttachment`) and the roster is read
 * from `state.getWebSockets()`, so the mocks below model both, and a regression to an
 * in-memory roster fails here instead of only in production.
 *
 * The Yjs assertions run against the REAL `yjs` and `y-protocols` packages: a fake would
 * only prove this file agrees with itself, and the whole point of the change is that the
 * bytes on the wire are the ones a `y-websocket` client expects.
 */

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

class MockWebSocket {
  static READY_STATE_OPEN = 1;
  readyState: number;
  sent: (string | Uint8Array)[] = [];
  private attachment: unknown = null;
  private _throwOnSend: boolean;

  constructor(open = true, throwOnSend = false) {
    this.readyState = open ? MockWebSocket.READY_STATE_OPEN : 3; // 3 = CLOSED
    this._throwOnSend = throwOnSend;
  }

  send(msg: string | Uint8Array) {
    if (this._throwOnSend) throw new Error('send error');
    this.sent.push(msg);
  }

  serializeAttachment(value: unknown) { this.attachment = value; }
  deserializeAttachment() { return this.attachment; }

  /** Only the binary frames, decoded far enough to say what they are. */
  frames(): Array<{ type: number; bytes: Uint8Array }> {
    return this.sent
      .filter((message): message is Uint8Array => message instanceof Uint8Array)
      .map((bytes) => ({ type: decoding.readVarUint(decoding.createDecoder(bytes)), bytes }));
  }
}

vi.stubGlobal('WebSocket', MockWebSocket);

/**
 * A state whose socket roster is REAL — `getWebSockets` returns what was accepted, the way
 * the runtime's does. The previous mock returned a fixed empty array, so no test could
 * have noticed the object broadcasting to nobody.
 */
function makeMockState(): DurableObjectState & { sockets: MockWebSocket[]; stored: Map<string, unknown> } {
  const sockets: MockWebSocket[] = [];
  const stored = new Map<string, unknown>();
  return {
    sockets,
    stored,
    acceptWebSocket: vi.fn((ws: MockWebSocket) => { sockets.push(ws); }),
    getWebSockets: vi.fn(() => sockets),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => { await fn(); }),
    storage: {
      get: vi.fn(async (key: string) => stored.get(key)),
      put: vi.fn(async (key: string, value: unknown) => { stored.set(key, value); }),
    } as unknown as DurableObjectStorage,
    id: {} as DurableObjectId,
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState & { sockets: MockWebSocket[]; stored: Map<string, unknown> };
}

/** Join a socket the way `fetch` would, without needing Cloudflare's `WebSocketPair`. */
function join(
  room: CollaborationRoom,
  state: ReturnType<typeof makeMockState>,
  ws: MockWebSocket,
  info: { userId: string; name: string; color: string },
) {
  state.sockets.push(ws);
  ws.serializeAttachment(info);
  return ws;
}

/** The bytes a `y-websocket` client sends when it has local changes. */
function clientUpdateFrame(doc: Y.Doc, mutate: (doc: Y.Doc) => void): Uint8Array {
  const before = Y.encodeStateVector(doc);
  mutate(doc);
  return encodeUpdate(Y.encodeStateAsUpdate(doc, before));
}

// ---------------------------------------------------------------------------

describe('CollaborationRoom construction', () => {
  it('creates an instance without throwing', () => {
    expect(() => new CollaborationRoom(makeMockState())).not.toThrow();
  });

  it('restores a persisted document rather than starting blank', async () => {
    const seed = new Y.Doc();
    seed.getText('content').insert(0, 'restored');
    const state = makeMockState();
    state.stored.set('ydoc:v1', Y.encodeStateAsUpdate(seed));

    const room = new CollaborationRoom(state);
    await Promise.resolve();

    const doc = (room as unknown as { doc: Y.Doc }).doc;
    expect(doc.getText('content').toString()).toBe('restored');
  });
});

describe('the y-websocket handshake', () => {
  it('applies a client update to the SERVER doc, not merely relaying it', () => {
    const state = makeMockState();
    const room = new CollaborationRoom(state);
    const sender = join(room, state, new MockWebSocket(), { userId: 'u1', name: 'Alice', color: '#111' });

    const client = new Y.Doc();
    room.webSocketMessage(
      sender as unknown as WebSocket,
      clientUpdateFrame(client, (doc) => doc.getText('content').insert(0, 'hello')).buffer as ArrayBuffer,
    );

    expect((room as unknown as { doc: Y.Doc }).doc.getText('content').toString()).toBe('hello');
  });

  it('answers SyncStep1 with the state a LATE JOINER is missing', () => {
    const state = makeMockState();
    const room = new CollaborationRoom(state);
    const first = join(room, state, new MockWebSocket(), { userId: 'u1', name: 'Alice', color: '#111' });

    const authored = new Y.Doc();
    room.webSocketMessage(
      first as unknown as WebSocket,
      clientUpdateFrame(authored, (doc) => doc.getText('content').insert(0, 'already here')).buffer as ArrayBuffer,
    );

    // A second person arrives with an empty doc and asks what it is missing. Against the
    // old relay nobody answered, so they adopted emptiness and merged it into the room.
    const late = join(room, state, new MockWebSocket(), { userId: 'u2', name: 'Bob', color: '#222' });
    const lateDoc = new Y.Doc();
    room.webSocketMessage(late as unknown as WebSocket, encodeSyncStep1(lateDoc).buffer as ArrayBuffer);

    const reply = late.frames().find((frame) => frame.type === MESSAGE_SYNC);
    expect(reply, 'the room must answer a sync request').toBeTruthy();

    const decoder = decoding.createDecoder(reply!.bytes);
    decoding.readVarUint(decoder); // message type
    syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), lateDoc, null);
    expect(lateDoc.getText('content').toString()).toBe('already here');
  });

  it('broadcasts an applied update to the other participants', () => {
    const state = makeMockState();
    const room = new CollaborationRoom(state);
    const sender = join(room, state, new MockWebSocket(), { userId: 'u1', name: 'Alice', color: '#111' });
    const peer = join(room, state, new MockWebSocket(), { userId: 'u2', name: 'Bob', color: '#222' });

    const client = new Y.Doc();
    room.webSocketMessage(
      sender as unknown as WebSocket,
      clientUpdateFrame(client, (doc) => doc.getText('content').insert(0, 'shared')).buffer as ArrayBuffer,
    );

    const peerDoc = new Y.Doc();
    for (const frame of peer.frames().filter((f) => f.type === MESSAGE_SYNC)) {
      const decoder = decoding.createDecoder(frame.bytes);
      decoding.readVarUint(decoder);
      syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), peerDoc, null);
    }
    expect(peerDoc.getText('content').toString()).toBe('shared');
    expect(sender.frames().some((f) => f.type === MESSAGE_SYNC && f.bytes.length > 2)).toBe(false);
  });

  it('persists the document after an update settles', async () => {
    vi.useFakeTimers();
    try {
      const state = makeMockState();
      const room = new CollaborationRoom(state);
      const sender = join(room, state, new MockWebSocket(), { userId: 'u1', name: 'Alice', color: '#111' });

      const client = new Y.Doc();
      room.webSocketMessage(
        sender as unknown as WebSocket,
        clientUpdateFrame(client, (doc) => doc.getText('content').insert(0, 'durable')).buffer as ArrayBuffer,
      );
      expect(state.stored.has('ydoc:v1'), 'a write must not be on the keystroke path').toBe(false);

      await vi.advanceTimersByTimeAsync(2_500);
      const restored = new Y.Doc();
      Y.applyUpdate(restored, state.stored.get('ydoc:v1') as Uint8Array);
      expect(restored.getText('content').toString()).toBe('durable');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('awareness', () => {
  it('holds the room roster so a late joiner sees who is already here', () => {
    const state = makeMockState();
    const room = new CollaborationRoom(state);
    const first = join(room, state, new MockWebSocket(), { userId: 'u1', name: 'Alice', color: '#111' });

    const clientDoc = new Y.Doc();
    const clientAwareness = new awarenessProtocol.Awareness(clientDoc);
    clientAwareness.setLocalState({ user: { name: 'Alice' } });
    room.webSocketMessage(
      first as unknown as WebSocket,
      encodeAwareness(clientAwareness, [clientDoc.clientID]).buffer as ArrayBuffer,
    );

    const roomAwareness = (room as unknown as { awareness: awarenessProtocol.Awareness }).awareness;
    expect(roomAwareness.getStates().get(clientDoc.clientID)).toEqual({ user: { name: 'Alice' } });
  });

  it('retires a departed participant instead of leaving a ghost cursor', () => {
    const state = makeMockState();
    const room = new CollaborationRoom(state);
    const leaver = join(room, state, new MockWebSocket(), { userId: 'u1', name: 'Alice', color: '#111' });
    const stayer = join(room, state, new MockWebSocket(), { userId: 'u2', name: 'Bob', color: '#222' });

    const clientDoc = new Y.Doc();
    const clientAwareness = new awarenessProtocol.Awareness(clientDoc);
    clientAwareness.setLocalState({ user: { name: 'Alice' } });
    room.webSocketMessage(
      leaver as unknown as WebSocket,
      encodeAwareness(clientAwareness, [clientDoc.clientID]).buffer as ArrayBuffer,
    );

    const before = stayer.sent.length;
    room.webSocketClose(leaver as unknown as WebSocket);

    const roomAwareness = (room as unknown as { awareness: awarenessProtocol.Awareness }).awareness;
    expect(roomAwareness.getStates().has(clientDoc.clientID)).toBe(false);
    expect(stayer.sent.length, 'the room must tell the others they left').toBeGreaterThan(before);
  });

  it('never advertises the SERVER as a participant', () => {
    const room = new CollaborationRoom(makeMockState());
    const roomAwareness = (room as unknown as { awareness: awarenessProtocol.Awareness }).awareness;
    expect(roomAwareness.getStates().size).toBe(0);
  });
});

describe('the JSON protocol the terminal and presence surfaces use', () => {
  let state: ReturnType<typeof makeMockState>;
  let room: CollaborationRoom;
  let sender: MockWebSocket;
  let peer1: MockWebSocket;
  let peer2: MockWebSocket;

  beforeEach(() => {
    state = makeMockState();
    room = new CollaborationRoom(state);
    sender = join(room, state, new MockWebSocket(), { userId: 'sender', name: 'Sender', color: '#111' });
    peer1 = join(room, state, new MockWebSocket(), { userId: 'p1', name: 'Peer1', color: '#222' });
    peer2 = join(room, state, new MockWebSocket(), { userId: 'p2', name: 'Peer2', color: '#333' });
  });

  it('does not send a message back to the sender', () => {
    room.webSocketMessage(sender as unknown as WebSocket, JSON.stringify({ type: 'yjs-update', data: 'abc' }));
    expect(sender.sent).toHaveLength(0);
  });

  it('relays the legacy yjs-update envelope to all peers', () => {
    const msg = JSON.stringify({ type: 'yjs-update', data: 'abc' });
    room.webSocketMessage(sender as unknown as WebSocket, msg);
    expect(peer1.sent).toEqual([msg]);
    expect(peer2.sent).toEqual([msg]);
  });

  it('enriches presence messages with sender identity', () => {
    room.webSocketMessage(sender as unknown as WebSocket, JSON.stringify({
      type: 'presence', cursor: { line: 1, column: 5 },
    }));
    const received = JSON.parse(peer1.sent[0] as string);
    expect(received).toMatchObject({ type: 'presence', userId: 'sender', name: 'Sender', color: '#111' });
  });

  it('enriches terminal-input messages with sender userId', () => {
    room.webSocketMessage(sender as unknown as WebSocket, JSON.stringify({ type: 'terminal-input', data: 'ls\n' }));
    expect(JSON.parse(peer1.sent[0] as string)).toMatchObject({ type: 'terminal-input', userId: 'sender', data: 'ls\n' });
  });

  it('relays terminal-output messages to all peers', () => {
    room.webSocketMessage(sender as unknown as WebSocket, JSON.stringify({ type: 'terminal-output', data: 'hello\n' }));
    expect(JSON.parse(peer1.sent[0] as string)).toMatchObject({ type: 'terminal-output', data: 'hello\n' });
  });

  it('skips a peer whose socket is closed', () => {
    const closed = join(room, state, new MockWebSocket(false), { userId: 'cp', name: 'Closed', color: '#fff' });
    room.webSocketMessage(sender as unknown as WebSocket, JSON.stringify({ type: 'yjs-update', data: 'x' }));
    expect(closed.sent).toHaveLength(0);
    expect(peer1.sent).toHaveLength(1);
  });

  it('keeps broadcasting past a peer that throws on send', () => {
    join(room, state, new MockWebSocket(true, true), { userId: 'bad', name: 'Bad', color: '#f00' });
    expect(() => room.webSocketMessage(sender as unknown as WebSocket, JSON.stringify({ type: 'yjs-update', data: 'x' }))).not.toThrow();
    expect(peer1.sent).toHaveLength(1);
    expect(peer2.sent).toHaveLength(1);
  });

  it('drops a frame from a socket that never joined, rather than crediting it to nobody', () => {
    const stranger = new MockWebSocket();
    expect(() => room.webSocketMessage(stranger as unknown as WebSocket, JSON.stringify({ type: 'presence' }))).not.toThrow();
    expect(peer1.sent).toHaveLength(0);
  });

  it('silently ignores unknown message types', () => {
    room.webSocketMessage(sender as unknown as WebSocket, JSON.stringify({ type: 'unknown-event', payload: 42 }));
    expect(peer1.sent).toHaveLength(0);
  });

  it('handles malformed JSON without throwing', () => {
    expect(() => room.webSocketMessage(sender as unknown as WebSocket, '{not valid json}')).not.toThrow();
  });
});
