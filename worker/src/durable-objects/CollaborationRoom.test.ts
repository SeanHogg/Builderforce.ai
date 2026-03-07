import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CollaborationRoom } from './CollaborationRoom';

// ---------------------------------------------------------------------------
// Minimal WebSocket mock that mirrors the Cloudflare Workers API surface
// used by CollaborationRoom:
//   - readyState
//   - send(msg)
//   - static READY_STATE_OPEN
// ---------------------------------------------------------------------------

class MockWebSocket {
  static READY_STATE_OPEN = 1;
  readyState: number;
  sent: (string | ArrayBuffer)[] = [];
  private _throwOnSend: boolean;

  constructor(open = true, throwOnSend = false) {
    this.readyState = open ? MockWebSocket.READY_STATE_OPEN : 3; // 3 = CLOSED
    this._throwOnSend = throwOnSend;
  }

  send(msg: string | ArrayBuffer) {
    if (this._throwOnSend) throw new Error('send error');
    this.sent.push(msg);
  }
}

// Make WebSocket available as a global so CollaborationRoom's
// `ws.readyState === WebSocket.READY_STATE_OPEN` comparison works.
vi.stubGlobal('WebSocket', MockWebSocket);

// ---------------------------------------------------------------------------
// Minimal DurableObjectState mock
// ---------------------------------------------------------------------------

function makeMockState(): DurableObjectState {
  return {
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn().mockReturnValue([]),
    blockConcurrencyWhile: vi.fn(),
    storage: {} as DurableObjectStorage,
    id: {} as DurableObjectId,
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState;
}

// ---------------------------------------------------------------------------
// Helper: inject sessions directly (bypasses Cloudflare-only WebSocketPair)
// ---------------------------------------------------------------------------

type SessionInfo = { userId: string; name: string; color: string };

function injectSession(
  room: CollaborationRoom,
  ws: MockWebSocket,
  info: SessionInfo
) {
  // CollaborationRoom.sessions is private; cast to any for test access
  (room as unknown as { sessions: Map<unknown, SessionInfo> }).sessions.set(
    ws,
    info
  );
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('CollaborationRoom constructor', () => {
  it('creates an instance without throwing', () => {
    const state = makeMockState();
    expect(() => new CollaborationRoom(state)).not.toThrow();
  });

  it('starts with an empty sessions map', () => {
    const room = new CollaborationRoom(makeMockState());
    const sessions = (room as unknown as { sessions: Map<unknown, unknown> }).sessions;
    expect(sessions.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// webSocketClose / webSocketError
// ---------------------------------------------------------------------------

describe('webSocketClose', () => {
  it('removes the session from the map', () => {
    const room = new CollaborationRoom(makeMockState());
    const ws = new MockWebSocket();
    injectSession(room, ws, { userId: 'u1', name: 'Alice', color: '#fff' });

    const sessions = (room as unknown as { sessions: Map<unknown, unknown> }).sessions;
    expect(sessions.size).toBe(1);

    room.webSocketClose(ws as unknown as WebSocket);
    expect(sessions.size).toBe(0);
  });

  it('is a no-op when the socket was never tracked', () => {
    const room = new CollaborationRoom(makeMockState());
    const ws = new MockWebSocket();
    expect(() => room.webSocketClose(ws as unknown as WebSocket)).not.toThrow();
  });
});

describe('webSocketError', () => {
  it('removes the session from the map', () => {
    const room = new CollaborationRoom(makeMockState());
    const ws = new MockWebSocket();
    injectSession(room, ws, { userId: 'u2', name: 'Bob', color: '#000' });

    room.webSocketError(ws as unknown as WebSocket);

    const sessions = (room as unknown as { sessions: Map<unknown, unknown> }).sessions;
    expect(sessions.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// broadcast (via webSocketMessage)
// ---------------------------------------------------------------------------

describe('broadcast', () => {
  let room: CollaborationRoom;
  let sender: MockWebSocket;
  let peer1: MockWebSocket;
  let peer2: MockWebSocket;

  beforeEach(() => {
    room = new CollaborationRoom(makeMockState());
    sender = new MockWebSocket();
    peer1 = new MockWebSocket();
    peer2 = new MockWebSocket();
    injectSession(room, sender, { userId: 'sender', name: 'Sender', color: '#111' });
    injectSession(room, peer1, { userId: 'p1', name: 'Peer1', color: '#222' });
    injectSession(room, peer2, { userId: 'p2', name: 'Peer2', color: '#333' });
  });

  it('does not send a message back to the sender', () => {
    const msg = JSON.stringify({ type: 'yjs-update', data: 'abc' });
    room.webSocketMessage(sender as unknown as WebSocket, msg);
    expect(sender.sent).toHaveLength(0);
  });

  it('broadcasts a yjs-update to all peers', () => {
    const msg = JSON.stringify({ type: 'yjs-update', data: 'abc' });
    room.webSocketMessage(sender as unknown as WebSocket, msg);
    expect(peer1.sent).toHaveLength(1);
    expect(peer2.sent).toHaveLength(1);
    expect(peer1.sent[0]).toBe(msg);
  });

  it('broadcasts binary Yjs updates to all peers', () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    room.webSocketMessage(sender as unknown as WebSocket, buffer);
    expect(peer1.sent).toHaveLength(1);
    expect(peer2.sent).toHaveLength(1);
  });

  it('enriches presence messages with sender identity', () => {
    room.webSocketMessage(sender as unknown as WebSocket, JSON.stringify({
      type: 'presence',
      cursor: { line: 1, column: 5 },
    }));
    const received = JSON.parse(peer1.sent[0] as string);
    expect(received.type).toBe('presence');
    expect(received.userId).toBe('sender');
    expect(received.name).toBe('Sender');
    expect(received.color).toBe('#111');
  });

  it('enriches terminal-input messages with sender userId', () => {
    room.webSocketMessage(sender as unknown as WebSocket, JSON.stringify({
      type: 'terminal-input',
      data: 'ls\n',
    }));
    const received = JSON.parse(peer1.sent[0] as string);
    expect(received.type).toBe('terminal-input');
    expect(received.userId).toBe('sender');
    expect(received.data).toBe('ls\n');
  });

  it('relays terminal-output messages to all peers', () => {
    room.webSocketMessage(sender as unknown as WebSocket, JSON.stringify({
      type: 'terminal-output',
      data: 'hello\n',
    }));
    expect(peer1.sent).toHaveLength(1);
    const received = JSON.parse(peer1.sent[0] as string);
    expect(received.type).toBe('terminal-output');
    expect(received.data).toBe('hello\n');
  });

  it('skips peers whose socket is closed (readyState !== READY_STATE_OPEN)', () => {
    const closedPeer = new MockWebSocket(false); // closed
    injectSession(room, closedPeer, { userId: 'cp', name: 'Closed', color: '#fff' });

    const msg = JSON.stringify({ type: 'yjs-update', data: 'x' });
    room.webSocketMessage(sender as unknown as WebSocket, msg);

    expect(closedPeer.sent).toHaveLength(0);
    expect(peer1.sent).toHaveLength(1);
    expect(peer2.sent).toHaveLength(1);
  });

  it('removes a peer that throws on send and continues broadcasting', () => {
    const badPeer = new MockWebSocket(true, true); // open but throws
    injectSession(room, badPeer, { userId: 'bad', name: 'Bad', color: '#red' });

    const msg = JSON.stringify({ type: 'yjs-update', data: 'x' });
    expect(() =>
      room.webSocketMessage(sender as unknown as WebSocket, msg)
    ).not.toThrow();

    const sessions = (room as unknown as { sessions: Map<unknown, unknown> }).sessions;
    expect(sessions.has(badPeer)).toBe(false);
    // healthy peers still got the message
    expect(peer1.sent).toHaveLength(1);
    expect(peer2.sent).toHaveLength(1);
  });

  it('silently ignores unknown message types', () => {
    expect(() =>
      room.webSocketMessage(
        sender as unknown as WebSocket,
        JSON.stringify({ type: 'unknown-event', payload: 42 })
      )
    ).not.toThrow();
    expect(peer1.sent).toHaveLength(0);
    expect(peer2.sent).toHaveLength(0);
  });

  it('handles malformed JSON without throwing', () => {
    expect(() =>
      room.webSocketMessage(sender as unknown as WebSocket, '{not valid json}')
    ).not.toThrow();
  });
});
