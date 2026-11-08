import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { CLOSE_TOO_LARGE, CollaborationRoomDO, MAX_STATE_BYTES, encodeUpdate } from './CollaborationRoomDO';
import { CHUNK_BYTES, CHUNK_COUNT_KEY, DOC_KEY, chunkKey } from './collabRoomStorage';

/** Storage chunking, the legacy single-key read, and the oversize guard. The base suite covers the protocol. */

class FakeSocket {
  static READY_STATE_OPEN = 1;
  readyState = 1;
  sent: unknown[] = [];
  closed: { code: number; reason: string } | null = null;
  private attachment: unknown = { userId: 'u1', name: 'A', color: '#111' };
  send(message: unknown) { this.sent.push(message); }
  close(code: number, reason: string) { this.closed = { code, reason }; this.readyState = 3; }
  serializeAttachment(value: unknown) { this.attachment = value; }
  deserializeAttachment() { return this.attachment; }
}
vi.stubGlobal('WebSocket', FakeSocket);

// The room's error sink, spied so the throttling of repeated failures can be counted.
const reported = vi.hoisted(() => vi.fn());
vi.mock('../../application/observability/durableErrorReporter', () => ({ createDurableErrorReporter: () => reported }));

function makeState() {
  const stored = new Map<string, unknown>();
  const sockets: FakeSocket[] = [];
  const state = {
    stored,
    sockets,
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn(() => sockets),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => { await fn(); }),
    storage: {
      get: vi.fn(async (key: string | string[]) => (Array.isArray(key)
        ? new Map(key.flatMap((item) => (stored.has(item) ? [[item, stored.get(item)] as const] : [])))
        : stored.get(key))),
      put: vi.fn(async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === 'string') stored.set(key, value);
        else for (const [name, item] of Object.entries(key)) stored.set(name, item);
      }),
      delete: vi.fn(async (keys: string[]) => { for (const key of keys) stored.delete(key); return keys.length; }),
    },
    id: { toString: () => 'room' },
    waitUntil: vi.fn(),
  };
  return state;
}

/** A Yjs update whose encoding is at least `bytes` long, from poorly compressible content. */
function bigUpdate(bytes: number): Uint8Array {
  const doc = new Y.Doc();
  const text = doc.getText('t');
  let seed = 7;
  let out = '';
  while (out.length < bytes) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; out += String.fromCharCode(33 + (seed % 90)); }
  text.insert(0, out);
  return Y.encodeStateAsUpdate(doc);
}

const roomOf = (state: ReturnType<typeof makeState>) => new CollaborationRoomDO(state as never);
/** Wait for the load the newest room ran under `blockConcurrencyWhile` (several storage reads, not one microtask). */
const loaded = async (state: ReturnType<typeof makeState>) => { await state.blockConcurrencyWhile.mock.results.at(-1)?.value; };
const docOf = (room: CollaborationRoomDO) => (room as unknown as { doc: Y.Doc }).doc;
type Internals = { persister: { persist: () => Promise<void>; shape: unknown }; admission: { settle: (bytes: number) => void } };
const persist = (room: CollaborationRoomDO) => (room as unknown as Internals).persister.persist();

describe('CollaborationRoomDO storage', () => {
  it('round-trips a state larger than one chunk through several keys', async () => {
    const state = makeState();
    const room = roomOf(state);
    await loaded(state);
    Y.applyUpdate(docOf(room), bigUpdate(CHUNK_BYTES * 2 + 5_000));
    await persist(room);

    expect(state.stored.has(DOC_KEY)).toBe(false);
    const count = state.stored.get(CHUNK_COUNT_KEY) as number;
    expect(count).toBeGreaterThanOrEqual(3);
    for (let index = 0; index < count; index += 1) expect((state.stored.get(chunkKey(index)) as Uint8Array).byteLength).toBeLessThanOrEqual(CHUNK_BYTES);

    const reopened = roomOf(state);
    await loaded(state);
    expect(docOf(reopened).getText('t').toString()).toBe(docOf(room).getText('t').toString());
  });

  it('reads the legacy single-key value', async () => {
    const seed = new Y.Doc();
    seed.getText('t').insert(0, 'legacy');
    const state = makeState();
    state.stored.set(DOC_KEY, Y.encodeStateAsUpdate(seed));
    const room = roomOf(state);
    await loaded(state);
    expect(docOf(room).getText('t').toString()).toBe('legacy');
  });

  it('writes a small state as the single key and removes stale chunks when a state shrinks', async () => {
    const state = makeState();
    const room = roomOf(state);
    await loaded(state);
    docOf(room).transact(() => docOf(room).getText('t').insert(0, 'x'.repeat(10)));
    state.stored.set(CHUNK_COUNT_KEY, 2);
    state.stored.set(chunkKey(0), new Uint8Array(1));
    state.stored.set(chunkKey(1), new Uint8Array(1));
    (room as unknown as Internals).persister.shape = { chunks: 2, legacy: false };
    await persist(room);
    expect(state.stored.has(DOC_KEY)).toBe(true);
    expect(state.stored.has(CHUNK_COUNT_KEY)).toBe(false);
    expect(state.stored.has(chunkKey(1))).toBe(false);
  });

  it('refuses an update that would push the room past the hard cap, closing the sender and not applying it', async () => {
    const state = makeState();
    const room = roomOf(state);
    await loaded(state);
    const sender = new FakeSocket();
    state.sockets.push(sender);
    (room as unknown as Internals).admission.settle(MAX_STATE_BYTES - 10);

    const client = new Y.Doc();
    client.getText('t').insert(0, 'this will not fit');
    const frame = encodeUpdate(Y.encodeStateAsUpdate(client));
    room.webSocketMessage(sender as unknown as WebSocket, frame.buffer as ArrayBuffer);

    expect(sender.closed?.code).toBe(CLOSE_TOO_LARGE);
    expect(docOf(room).getText('t').toString()).toBe('');
  });

  it('reports a failing persist at most once per interval', async () => {
    vi.useFakeTimers();
    try {
      const state = makeState();
      state.storage.put.mockRejectedValue(new Error('value too large'));
      const room = roomOf(state);
      await loaded(state);
      reported.mockClear();
      await persist(room);
      await persist(room);
      expect(reported).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      await persist(room);
      expect(reported).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
