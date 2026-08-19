/**
 * PeerRelay — the one client→client WebSocket relay every live room uses.
 *
 * THREE rooms had grown their own copy of the same twenty lines: a
 * `Map<WebSocket, Peer>`, a monotonic peer id, a roster projection, a
 * "broadcast to everyone except the sender" loop, and a `join` frame that let a
 * CLIENT declare who it was. {@link CeremonyRoomDO}, {@link GuestRoomDO} and now
 * the canvas room (via {@link SessionRoomDO}) share this instead — one place
 * where a peer is registered, attributed, rate-limited and fanned out.
 *
 * What the copies did NOT have, and what makes this safe to point at the canvas:
 *
 *  - **Server-asserted identity.** A peer may be created with an identity the
 *    caller (the authed route) supplies, and when it is, a client `join` frame
 *    can no longer overwrite it. That is the difference between "a collaborator's
 *    cursor" and "any connected socket claiming to be that collaborator".
 *  - **A per-peer rate limit.** Pointer frames arrive at pointer speed; a token
 *    bucket caps what one socket can make the room fan out, so a hostile or
 *    looping client cannot turn N peers into an N× amplifier.
 *  - **A frame allow-list and a sanitizer.** A room may declare which client
 *    frame types it relays at all, and rewrite each one to a fixed shape. The
 *    canvas room uses both, which is what preserves the property the relay was
 *    kept domain-free for: nothing but ephemeral pointer state can cross it.
 *
 * The relay owns no storage and no domain data — a room that needs either keeps
 * it in the DO, as `GuestRoomDO` does with its transcript and turn budget.
 */

/** A connected socket and the identity the room attributes its frames to. */
export interface RelayPeer {
  ws: WebSocket;
  /** Room-local socket id (`p1`, `g2`, …). Unique per DO instance, not durable. */
  id: string;
  name: string;
  /** 'human' | 'cloud_agent' | 'host_agent' — matches the seat's member kind. */
  kind: string;
  /** Stable identity (users.id / ide_agents.id / visitorId) used to attribute frames. */
  ref: string;
  /** Sub-channel; frames and rosters never cross channels (`chat` vs `media`). */
  channel: string;
  /** True when the identity came from the SERVER and a `join` frame may not change it. */
  fixedIdentity: boolean;
  /** Token bucket for {@link PeerRelay.relay}. */
  tokens: number;
  refilledAtMs: number;
}

/** The identity a route (or the DO) asserts for a socket at connect time. */
export interface RelayIdentity {
  name?: string;
  kind?: string;
  ref?: string;
  channel?: string;
}

export interface PeerRelayOptions {
  /** Prefix for room-local peer ids, so a log line says which room shape it came from. */
  idPrefix?: string;
  /**
   * Client frame types this room relays. Omit to relay any type (the legacy
   * ceremony/guest behaviour, where the frame set is open-ended WebRTC signaling).
   */
  allowFrames?: readonly string[];
  /** Sustained client frames per second, per peer. */
  framesPerSecond?: number;
  /** Bucket depth, so a burst of pointer moves is not clipped. */
  burst?: number;
  /** Largest client frame relayed, in characters. */
  maxFrameChars?: number;
  /**
   * Rewrite an accepted client frame to the shape this room relays. Return null to
   * drop it. Defaults to relaying the parsed frame as-is.
   */
  sanitize?: (frame: Record<string, unknown>, peer: RelayPeer) => object | null;
  /** Fields the SERVER stamps onto every relayed frame. Defaults to `{ from: peer.id }`. */
  stamp?: (peer: RelayPeer) => Record<string, unknown>;
  /** Roster projection. Defaults to `{ id, name, kind, ref }`. */
  publicPeer?: (peer: RelayPeer) => Record<string, unknown>;
  /** Injectable clock (tests). */
  now?: () => number;
}

const DEFAULTS = {
  idPrefix: 'p',
  framesPerSecond: 30,
  burst: 60,
  maxFrameChars: 4_096,
} as const;

export class PeerRelay {
  private peers = new Map<WebSocket, RelayPeer>();
  private seq = 0;
  private readonly opts: Required<Pick<PeerRelayOptions, 'idPrefix' | 'framesPerSecond' | 'burst' | 'maxFrameChars'>> & PeerRelayOptions;

  constructor(options: PeerRelayOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  get size(): number {
    return this.peers.size;
  }

  /** Register a socket. An identity given here is SERVER-asserted and immutable. */
  add(ws: WebSocket, identity: RelayIdentity = {}): RelayPeer {
    const peer: RelayPeer = {
      ws,
      id: `${this.opts.idPrefix}${++this.seq}`,
      name: identity.name ?? '',
      kind: identity.kind ?? '',
      ref: identity.ref ?? '',
      channel: identity.channel ?? 'default',
      fixedIdentity: typeof identity.ref === 'string' && identity.ref.length > 0,
      tokens: this.opts.burst,
      refilledAtMs: this.clock(),
    };
    this.peers.set(ws, peer);
    return peer;
  }

  /** Forget a socket. Returns the peer when it was still registered. */
  remove(ws: WebSocket): RelayPeer | null {
    const peer = this.peers.get(ws) ?? null;
    this.peers.delete(ws);
    return peer;
  }

  get(ws: WebSocket): RelayPeer | null {
    return this.peers.get(ws) ?? null;
  }

  list(channel?: string): RelayPeer[] {
    const all = [...this.peers.values()];
    return channel == null ? all : all.filter((peer) => peer.channel === channel);
  }

  /**
   * Apply a client `join` frame.
   *
   * A DISPLAY NAME is always the client's to set — a guest typing what to call
   * themselves is the whole point of the frame. `ref` and `kind` are not: for a
   * peer whose identity the SERVER asserted they are ignored, so a socket cannot
   * rename itself into somebody else's identity and inherit their cursor.
   */
  identify(peer: RelayPeer, identity: RelayIdentity): void {
    if (identity.name != null) peer.name = String(identity.name);
    if (peer.fixedIdentity) return;
    if (identity.kind != null) peer.kind = String(identity.kind);
    if (identity.ref != null) peer.ref = String(identity.ref);
  }

  /** Drop every peer (the room is over). Sockets are closed by the caller. */
  clear(): void {
    this.peers.clear();
  }

  /** Roster for one channel (defaults to every channel). */
  roster(channel?: string): Array<Record<string, unknown>> {
    return this.list(channel).map((peer) => this.publicPeer(peer));
  }

  publicPeer(peer: RelayPeer): Record<string, unknown> {
    return this.opts.publicPeer?.(peer) ?? { id: peer.id, name: peer.name, kind: peer.kind, ref: peer.ref };
  }

  send(peer: RelayPeer, frame: unknown): void {
    try { peer.ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame)); }
    catch { this.peers.delete(peer.ws); }
  }

  /** Send `data` to every peer on `channel`, except `except` (null = everyone). */
  broadcast(data: string, opts: { channel?: string; except?: WebSocket | null } = {}): void {
    for (const [ws, peer] of [...this.peers]) {
      if (ws === opts.except) continue;
      if (opts.channel != null && peer.channel !== opts.channel) continue;
      try { ws.send(data); } catch { this.peers.delete(ws); }
    }
  }

  /** Announce a join to the peer's own channel. */
  announceJoin(peer: RelayPeer): void {
    this.broadcast(
      JSON.stringify({ type: 'presence', action: 'join', peer: this.publicPeer(peer) }),
      { channel: peer.channel, except: peer.ws },
    );
  }

  /** Announce a leave to the peer's own channel. Call AFTER {@link remove}. */
  announceLeave(peer: RelayPeer): void {
    this.broadcast(
      JSON.stringify({ type: 'presence', action: 'leave', peer: { id: peer.id } }),
      { channel: peer.channel, except: peer.ws },
    );
  }

  /**
   * Decide what (if anything) a client frame relays as. Exposed for assertions;
   * {@link relay} is what a room calls.
   *
   * Rejects, in order: an oversized frame, a non-JSON frame, a frame with no
   * `type`, a type outside the allow-list, a frame the sanitizer drops, and a
   * peer that is over its rate limit.
   */
  accept(peer: RelayPeer, raw: unknown): string | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > this.opts.maxFrameChars) return null;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') return null;
    if (this.opts.allowFrames && !this.opts.allowFrames.includes(parsed.type)) return null;
    const shaped = this.opts.sanitize ? this.opts.sanitize(parsed, peer) : parsed;
    if (!shaped) return null;
    if (!this.spend(peer)) return null;
    const stamp = this.opts.stamp?.(peer) ?? { from: peer.id };
    return JSON.stringify({ ...shaped, ...stamp });
  }

  /**
   * Relay one client frame to the peer's channel. Returns false when the frame
   * was refused (malformed, disallowed, or over the rate limit) — a refusal is
   * silent by design: telling a flooding client that it is being dropped only
   * invites it to retry.
   */
  relay(peer: RelayPeer, raw: unknown): boolean {
    const frame = this.accept(peer, raw);
    if (!frame) return false;
    this.broadcast(frame, { channel: peer.channel, except: peer.ws });
    return true;
  }

  /** Token bucket: refill by elapsed time, then take one. */
  private spend(peer: RelayPeer): boolean {
    const now = this.clock();
    const elapsed = Math.max(0, now - peer.refilledAtMs);
    peer.refilledAtMs = now;
    peer.tokens = Math.min(this.opts.burst, peer.tokens + (elapsed / 1_000) * this.opts.framesPerSecond);
    if (peer.tokens < 1) return false;
    peer.tokens -= 1;
    return true;
  }

  private clock(): number {
    return this.opts.now?.() ?? Date.now();
  }
}
