/**
 * "Perfect negotiation" for one mesh peer connection — the only safe way for BOTH ends
 * of a pair to be allowed to renegotiate (a camera turned on mid-call, a screen
 * published) without the two offers colliding.
 *
 * The initial offer is already deterministic (the greater socket id offers), but once a
 * call is up either side may need a new offer at any moment, and two people turning
 * their cameras on in the same second used to land in `have-local-offer` on both ends,
 * where each `setRemoteDescription(offer)` threw and the track never arrived.
 *
 * The rule (WebRTC spec, "perfect negotiation"): every pair has one POLITE and one
 * IMPOLITE end. On a collision the impolite end ignores the incoming offer (its own
 * wins); the polite end accepts it — `setRemoteDescription(offer)` rolls its own pending
 * offer back implicitly — and answers. Exactly one offer wins, and nothing throws.
 *
 * Politeness is decided from the relay-assigned socket ids, which are unique in the room
 * and seen identically by both ends (a user id could tie across two tabs).
 */

/** The slice of `RTCPeerConnection` the protocol touches — so it can be driven by a mock. */
export interface NegotiationPc {
  readonly signalingState: RTCSignalingState;
  readonly localDescription: RTCSessionDescriptionInit | null;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
}

/** The per-peer flags the protocol keeps. */
export interface PeerNegotiation {
  /** This end yields on a collision. */
  polite: boolean;
  /** An offer of ours is being created / applied right now. */
  makingOffer: boolean;
  /** The last incoming offer was ignored; its ICE candidates are stray. */
  ignoreOffer: boolean;
}

export type SendFrame = (frame: Record<string, unknown>) => void;

/** Deterministic and complementary: of any two ids, exactly one end is polite. */
export function isPolite(myId: string, peerId: string): boolean {
  return myId < peerId;
}

export function newNegotiation(myId: string, peerId: string): PeerNegotiation {
  return { polite: isPolite(myId, peerId), makingOffer: false, ignoreOffer: false };
}

/**
 * Every step below resolves to whether it took effect (`false`: ignored as stale or
 * colliding, or the browser refused it — a superseded offer, a stale answer, a bad ICE
 * candidate, all non-fatal for a mesh and retried by the next negotiation). None throws.
 */

/** Create and send an offer to `peerId`. Safe to call at any time. */
export async function offerTo(pc: NegotiationPc, state: PeerNegotiation, peerId: string, send: SendFrame): Promise<boolean> {
  try {
    state.makingOffer = true;
    const offer = await pc.createOffer();
    // A remote offer was applied while ours was being created: ours is stale. The peer's
    // offer is being answered; the next change renegotiates again.
    if (pc.signalingState !== 'stable') return false;
    await pc.setLocalDescription(offer);
    send({ type: 'rtc-offer', to: peerId, sdp: pc.localDescription });
    return true;
  } catch {
    return false;
  } finally {
    state.makingOffer = false;
  }
}

/** Apply an incoming offer: yield (polite), ignore (impolite collision) or just answer. */
export async function onOffer(
  pc: NegotiationPc, state: PeerNegotiation, peerId: string, sdp: RTCSessionDescriptionInit, send: SendFrame,
): Promise<boolean> {
  try {
    const collision = state.makingOffer || pc.signalingState !== 'stable';
    state.ignoreOffer = !state.polite && collision;
    if (state.ignoreOffer) return false;
    // For the polite end this also rolls its own pending offer back.
    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send({ type: 'rtc-answer', to: peerId, sdp: pc.localDescription });
    return true;
  } catch {
    return false; // malformed or superseded offer
  }
}

/** Apply an answer — only to an offer we are actually waiting on. */
export async function onAnswer(pc: NegotiationPc, sdp: RTCSessionDescriptionInit): Promise<boolean> {
  if (pc.signalingState !== 'have-local-offer') return false;
  try {
    await pc.setRemoteDescription(sdp);
    return true;
  } catch {
    return false; // stale answer
  }
}

/** Apply an ICE candidate, unless it belongs to an offer we ignored. */
export async function onCandidate(pc: NegotiationPc, state: PeerNegotiation, candidate: RTCIceCandidateInit): Promise<boolean> {
  if (state.ignoreOffer) return false;
  try {
    await pc.addIceCandidate(candidate);
    return true;
  } catch {
    return false;
  }
}
