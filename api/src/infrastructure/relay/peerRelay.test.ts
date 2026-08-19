import { describe, it, expect } from 'vitest';
import { PeerRelay } from './peerRelay';
import { CANVAS_PRESENCE_FRAME, canvasPresenceFrame } from '@builderforce/creation-canvas-contract';

/**
 * The relay is the only thing standing between "a collaborator's pointer" and "any
 * socket in the room saying whatever it likes to everyone else". These assert the
 * three properties that make it safe to point at the canvas: identity the client
 * cannot claim, a shape it cannot exceed, and a rate it cannot beat.
 */

/** A socket that records what was sent to it. Enough: the relay only calls `send`. */
function fakeSocket() {
  const sent: string[] = [];
  return {
    sent,
    ws: { send: (data: string) => { sent.push(data); } } as unknown as WebSocket,
  };
}

function canvasRelay(now: () => number) {
  return new PeerRelay({
    allowFrames: [CANVAS_PRESENCE_FRAME],
    sanitize: (frame) => canvasPresenceFrame(frame),
    stamp: (peer) => ({ type: CANVAS_PRESENCE_FRAME, from: peer.id, userId: peer.ref }),
    framesPerSecond: 30,
    burst: 60,
    maxFrameChars: 512,
    now,
  });
}

describe('PeerRelay', () => {
  it('relays a frame to the other peers and never back to the sender', () => {
    const relay = new PeerRelay();
    const a = fakeSocket();
    const b = fakeSocket();
    const peerA = relay.add(a.ws);
    relay.add(b.ws);

    expect(relay.relay(peerA, JSON.stringify({ type: 'cursor', x: 1 }))).toBe(true);

    expect(a.sent).toEqual([]);
    expect(JSON.parse(b.sent[0]!)).toMatchObject({ type: 'cursor', x: 1, from: peerA.id });
  });

  it('keeps channels apart — a media frame never lands in the chat channel', () => {
    const relay = new PeerRelay();
    const chat = fakeSocket();
    const media = fakeSocket();
    relay.add(chat.ws, { channel: 'chat' });
    const mediaPeer = relay.add(media.ws, { channel: 'media' });
    const other = fakeSocket();
    relay.add(other.ws, { channel: 'media' });

    relay.relay(mediaPeer, JSON.stringify({ type: 'rtc-offer' }));

    expect(chat.sent).toEqual([]);
    expect(other.sent).toHaveLength(1);
  });

  it('refuses a `join` frame that tries to take over a server-asserted identity', () => {
    const relay = new PeerRelay();
    const socket = fakeSocket();
    const peer = relay.add(socket.ws, { ref: 'user-real', kind: 'human', name: 'Real' });

    relay.identify(peer, { ref: 'user-victim', kind: 'cloud_agent', name: 'Chosen name' });

    expect(peer.ref).toBe('user-real');
    expect(peer.kind).toBe('human');
    // A display name is the client's to choose; an identity is not.
    expect(peer.name).toBe('Chosen name');
  });

  it('lets an anonymous peer declare its own identity (the ceremony round table)', () => {
    const relay = new PeerRelay();
    const peer = relay.add(fakeSocket().ws);

    relay.identify(peer, { ref: 'agent-7', kind: 'cloud_agent', name: 'Scout' });

    expect(peer).toMatchObject({ ref: 'agent-7', kind: 'cloud_agent', name: 'Scout' });
  });

  it('drops malformed, oversized and non-string frames without throwing', () => {
    const relay = new PeerRelay({ maxFrameChars: 32 });
    const peer = relay.add(fakeSocket().ws);

    expect(relay.relay(peer, 'not json')).toBe(false);
    expect(relay.relay(peer, JSON.stringify({ noType: true }))).toBe(false);
    expect(relay.relay(peer, JSON.stringify({ type: 'x', pad: 'y'.repeat(64) }))).toBe(false);
    expect(relay.relay(peer, null)).toBe(false);
  });

  describe('the canvas room', () => {
    it('carries pointer state and NOTHING else, whatever the client sends', () => {
      const relay = canvasRelay(() => 1_000);
      const listener = fakeSocket();
      const peer = relay.add(fakeSocket().ws, { ref: 'user-a', kind: 'human' });
      relay.add(listener.ws, { ref: 'user-b', kind: 'human' });

      relay.relay(peer, JSON.stringify({
        type: CANVAS_PRESENCE_FRAME,
        cursor: { x: 12, y: -4 },
        typing: true,
        // The half of the frame the relay exists to refuse.
        secret: 'tenant-b board contents',
        tenantId: 99,
      }));

      const relayed = JSON.parse(listener.sent[0]!);
      expect(relayed).toEqual({
        type: CANVAS_PRESENCE_FRAME,
        cursor: { x: 12, y: -4 },
        typing: true,
        from: peer.id,
        userId: 'user-a',
      });
      expect(relayed.secret).toBeUndefined();
    });

    it('stamps the identity the ROUTE asserted, not the one the frame claims', () => {
      const relay = canvasRelay(() => 1_000);
      const listener = fakeSocket();
      const peer = relay.add(fakeSocket().ws, { ref: 'user-a' });
      relay.add(listener.ws, { ref: 'user-b' });

      relay.relay(peer, JSON.stringify({ type: CANVAS_PRESENCE_FRAME, cursor: { x: 1, y: 1 }, userId: 'user-b', from: 'p99' }));

      expect(JSON.parse(listener.sent[0]!)).toMatchObject({ userId: 'user-a', from: peer.id });
    });

    it('relays only `canvas.presence` — a `changed` frame from a client is refused', () => {
      const relay = canvasRelay(() => 1_000);
      const listener = fakeSocket();
      const peer = relay.add(fakeSocket().ws, { ref: 'user-a' });
      relay.add(listener.ws, { ref: 'user-b' });

      expect(relay.relay(peer, JSON.stringify({ type: 'canvas.changed', revision: 999 }))).toBe(false);
      expect(listener.sent).toEqual([]);
    });

    it('caps one socket at its sustained rate, and refills over time', () => {
      let now = 0;
      const relay = canvasRelay(() => now);
      const listener = fakeSocket();
      const peer = relay.add(fakeSocket().ws, { ref: 'user-a' });
      relay.add(listener.ws, { ref: 'user-b' });
      const frame = JSON.stringify({ type: CANVAS_PRESENCE_FRAME, cursor: { x: 1, y: 1 } });

      // A tight loop with no clock advance may spend the burst and no more.
      let accepted = 0;
      for (let i = 0; i < 500; i += 1) if (relay.relay(peer, frame)) accepted += 1;
      expect(accepted).toBe(60);

      // One second later the bucket has refilled at 30/s.
      now += 1_000;
      accepted = 0;
      for (let i = 0; i < 500; i += 1) if (relay.relay(peer, frame)) accepted += 1;
      expect(accepted).toBe(30);
    });

    it('preserves `cursor: null` — a retracted pointer is not a dropped frame', () => {
      const relay = canvasRelay(() => 1_000);
      const listener = fakeSocket();
      const peer = relay.add(fakeSocket().ws, { ref: 'user-a' });
      relay.add(listener.ws, { ref: 'user-b' });

      relay.relay(peer, JSON.stringify({ type: CANVAS_PRESENCE_FRAME, cursor: null }));

      expect(JSON.parse(listener.sent[0]!)).toMatchObject({ cursor: null, userId: 'user-a' });
    });
  });

  it('announces a join to the room and a leave after removal', () => {
    const relay = new PeerRelay();
    const watcher = fakeSocket();
    relay.add(watcher.ws, { name: 'Watcher' });
    const joiner = relay.add(fakeSocket().ws, { name: 'Joiner', kind: 'human', ref: 'u2' });

    relay.announceJoin(joiner);
    relay.remove(joiner.ws);
    relay.announceLeave(joiner);

    expect(watcher.sent.map((frame) => JSON.parse(frame))).toEqual([
      { type: 'presence', action: 'join', peer: { id: joiner.id, name: 'Joiner', kind: 'human', ref: 'u2' } },
      { type: 'presence', action: 'leave', peer: { id: joiner.id } },
    ]);
  });

  it('forgets a socket whose send throws, so a dead peer stops being fanned out to', () => {
    const relay = new PeerRelay();
    const dead = { send: () => { throw new Error('closed'); } } as unknown as WebSocket;
    relay.add(dead);
    const live = fakeSocket();
    relay.add(live.ws);

    relay.broadcast('{"type":"changed"}');

    expect(relay.size).toBe(1);
    expect(live.sent).toHaveLength(1);
  });
});
