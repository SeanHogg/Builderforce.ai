/** @vitest-environment jsdom */
// A hook that mounts needs a DOM: `src/lib/**` runs in the node project by default
// (see vitest.config.ts), and this docblock is the declared way to opt one file back in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMediaRoom, type MediaRoomTransport } from './useMediaRoom';

/**
 * "It says connecting and then never connects."
 *
 * That report had nothing behind it because the hook could not tell the difference
 * between the half-second before a healthy call and either of the two ways a call never
 * comes up. Worse, one of them was permanent BY CONSTRUCTION: the credential was read
 * once, outside the retry loop, and a missing one returned from the effect — so a room
 * opened a beat before its token existed (a guest room being minted, a session being
 * refreshed) could never connect at all, no matter how long anybody waited.
 *
 * These are the two states that were previously indistinguishable, plus the recovery
 * that could not happen.
 */

class FakeSocket {
  static last: FakeSocket | null = null;
  static opened: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor(readonly url: string) {
    FakeSocket.last = this;
    FakeSocket.opened.push(url);
  }
  send() { /* the join frame; nothing under test reads it */ }
  close() { this.readyState = 3; this.onclose?.(); }
  /** The relay accepted the upgrade. */
  accept() { this.readyState = 1; this.onopen?.(); }
  /** The relay refused it, or the call dropped — the socket closes either way. */
  drop() { this.readyState = 3; this.onclose?.(); }
}

const ME = { name: 'Sean', ref: 'sean' };

/**
 * Let the effect's async prologue settle — local media (unavailable in jsdom, so it
 * rejects and is caught) and the ICE fetch both run before the socket is opened.
 *
 * Explicit advancement rather than `waitFor`, which polls on the very timers this suite
 * fakes and would therefore wait for a clock nobody is winding.
 */
async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

describe('the media room reports WHY it is not connected', () => {
  let originalSocket: typeof WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    originalSocket = globalThis.WebSocket;
    FakeSocket.last = null;
    FakeSocket.opened = [];
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalSocket;
    vi.useRealTimers();
  });

  /** THE BUG. No credential used to mean the effect returned and nothing ever ran again. */
  it('says unauthenticated while the transport has no credential, and heals when one arrives', async () => {
    let token: string | null = null;
    // A module-stable object: the hook keys its connect effect on this identity, and a
    // transport re-created per render would restart the call on every state change.
    const transport: MediaRoomTransport = {
      getToken: () => token,
      signalingUrl: (room, credential) => `wss://relay.test/${room}?token=${credential}`,
      ice: async () => ({}),
    };

    const { result } = renderHook(() => useMediaRoom('canvas:1', ME, { enabled: true, transport }));

    // getUserMedia is unavailable in jsdom and the ICE fetch resolves empty; both are
    // awaited before the socket, so let them settle.
    await settle();
    expect(result.current.connection).toBe('unauthenticated');
    expect(FakeSocket.opened).toEqual([]);

    // The token is minted a moment later. The SAME retry loop that survives a dropped
    // socket has to pick it up — this is the assertion the old code could not pass.
    token = 'guest-token';
    await settle(2000);
    expect(FakeSocket.opened).toEqual(['wss://relay.test/canvas:1?token=guest-token']);

    act(() => FakeSocket.last!.accept());
    expect(result.current.connection).toBe('connected');
    expect(result.current.connected).toBe(true);
  });

  /** A refused upgrade and a dropped call both close the socket; both are `retrying`,
   *  which is the honest word for what the loop is about to do — and NOT the same word
   *  the first attempt shows. */
  it('says retrying once the relay closes the socket, and keeps trying', async () => {
    const transport: MediaRoomTransport = {
      getToken: () => 'tenant-token',
      signalingUrl: (room, credential) => `wss://relay.test/${room}?token=${credential}`,
      ice: async () => ({}),
    };

    const { result } = renderHook(() => useMediaRoom('canvas:2', ME, { enabled: true, transport }));
    await settle();
    expect(FakeSocket.opened).toHaveLength(1);

    act(() => FakeSocket.last!.drop());
    expect(result.current.connection).toBe('retrying');
    expect(result.current.connected).toBe(false);

    await settle(2000);
    expect(FakeSocket.opened).toHaveLength(2);
  });

  /** No room is not a failure, and must not read as one. */
  it('is idle while there is no call', async () => {
    const transport: MediaRoomTransport = {
      getToken: () => 'tenant-token',
      signalingUrl: (room, credential) => `wss://relay.test/${room}?token=${credential}`,
      ice: async () => ({}),
    };
    const { result } = renderHook(() => useMediaRoom(null, ME, { enabled: false, transport }));
    await settle();
    expect(result.current.connection).toBe('idle');
    expect(FakeSocket.opened).toEqual([]);
  });
});
