import { describe, expect, it } from 'vitest';
import {
  isPolite, newNegotiation, offerTo, onAnswer, onCandidate, onOffer,
  type NegotiationPc, type PeerNegotiation, type SendFrame,
} from './peerNegotiation';

/**
 * A just-enough RTCPeerConnection: it enforces the signaling state machine the real one
 * does — applying an answer with no offer pending throws — and implements the implicit
 * rollback `setRemoteDescription(offer)` performs from `have-local-offer`.
 */
class MockPc implements NegotiationPc {
  signalingState: RTCSignalingState = 'stable';
  localDescription: RTCSessionDescriptionInit | null = null;
  rollbacks = 0;
  appliedRemoteOffers = 0;
  candidates: RTCIceCandidateInit[] = [];
  private n = 0;
  constructor(private readonly label: string) {}

  async createOffer() { return { type: 'offer' as const, sdp: `${this.label}-offer-${++this.n}` }; }
  async createAnswer() { return { type: 'answer' as const, sdp: `${this.label}-answer-${++this.n}` }; }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    if (d.type === 'offer') {
      if (this.signalingState !== 'stable') throw new Error('InvalidStateError: offer while not stable');
      this.signalingState = 'have-local-offer';
    } else {
      if (this.signalingState !== 'have-remote-offer') throw new Error('InvalidStateError: answer without remote offer');
      this.signalingState = 'stable';
    }
    this.localDescription = d;
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    if (d.type === 'offer') {
      if (this.signalingState === 'have-local-offer') this.rollbacks += 1; // implicit rollback
      this.appliedRemoteOffers += 1;
      this.signalingState = 'have-remote-offer';
    } else {
      if (this.signalingState !== 'have-local-offer') throw new Error('InvalidStateError: answer without local offer');
      this.signalingState = 'stable';
    }
  }
  async addIceCandidate(c: RTCIceCandidateInit) { this.candidates.push(c); }
}

interface End { pc: MockPc; state: PeerNegotiation; id: string; outbox: Array<Record<string, unknown>>; send: SendFrame }

function end(id: string, peerId: string): End {
  const outbox: Array<Record<string, unknown>> = [];
  return { pc: new MockPc(id), state: newNegotiation(id, peerId), id, outbox, send: (frame) => { outbox.push(frame); } };
}

/** Deliver everything `from` has sent to `to`, as the relay would. */
async function deliver(from: End, to: End): Promise<void> {
  const frames = from.outbox.splice(0);
  for (const frame of frames) {
    const sdp = frame.sdp as RTCSessionDescriptionInit;
    if (frame.type === 'rtc-offer') await onOffer(to.pc, to.state, from.id, sdp, to.send);
    else if (frame.type === 'rtc-answer') await onAnswer(to.pc, sdp);
  }
}

describe('perfect negotiation', () => {
  it('assigns complementary roles: of any two ids exactly one end is polite', () => {
    expect(isPolite('p1', 'p2')).toBe(true);
    expect(isPolite('p2', 'p1')).toBe(false);
  });

  it('converges when both ends offer at once, and exactly one offer wins', async () => {
    const polite = end('p1', 'p2');
    const impolite = end('p2', 'p1');
    expect(polite.state.polite).toBe(true);
    expect(impolite.state.polite).toBe(false);

    // Both turn their camera on in the same instant: both create and send an offer.
    await Promise.all([
      offerTo(polite.pc, polite.state, 'p2', polite.send),
      offerTo(impolite.pc, impolite.state, 'p1', impolite.send),
    ]);
    expect(polite.pc.signalingState).toBe('have-local-offer');
    expect(impolite.pc.signalingState).toBe('have-local-offer');

    // The offers cross on the wire — neither throws.
    await expect(deliver(polite, impolite)).resolves.toBeUndefined();
    await expect(deliver(impolite, polite)).resolves.toBeUndefined();

    // The impolite end IGNORED the polite end's offer; the polite end yielded (rolled back)
    // and answered the impolite end's. So the impolite offer is the one that won.
    expect(impolite.pc.appliedRemoteOffers).toBe(0);
    expect(polite.pc.rollbacks).toBe(1);
    expect(polite.pc.appliedRemoteOffers).toBe(1);

    // The polite end's answer completes the winning offer; both settle.
    await deliver(polite, impolite);
    expect(polite.pc.signalingState).toBe('stable');
    expect(impolite.pc.signalingState).toBe('stable');
    expect(polite.outbox).toHaveLength(0);
    expect(impolite.outbox).toHaveLength(0);
  });

  it('ignores ICE from an offer it ignored, and applies ICE otherwise', async () => {
    const polite = end('p1', 'p2');
    const impolite = end('p2', 'p1');
    await Promise.all([
      offerTo(polite.pc, polite.state, 'p2', polite.send),
      offerTo(impolite.pc, impolite.state, 'p1', impolite.send),
    ]);
    await deliver(polite, impolite); // ignored
    await onCandidate(impolite.pc, impolite.state, { candidate: 'stray' });
    expect(impolite.pc.candidates).toHaveLength(0);

    await deliver(impolite, polite); // accepted
    await onCandidate(polite.pc, polite.state, { candidate: 'real' });
    expect(polite.pc.candidates).toEqual([{ candidate: 'real' }]);
  });

  it('answers a plain offer with no collision', async () => {
    const a = end('p1', 'p2');
    const b = end('p2', 'p1');
    await offerTo(b.pc, b.state, 'p1', b.send);
    await deliver(b, a);
    await deliver(a, b);
    expect(a.pc.signalingState).toBe('stable');
    expect(b.pc.signalingState).toBe('stable');
  });

  it('drops a stale answer instead of throwing', async () => {
    const a = end('p1', 'p2');
    await expect(onAnswer(a.pc, { type: 'answer', sdp: 'late' })).resolves.toBe(false);
  });
});
