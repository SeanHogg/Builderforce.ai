import { CANVAS_PRESENCE_FRAME, canvasPresenceFrame, type CanvasPresenceFrame, type CanvasPresenceState } from '@builderforce/creation-canvas-contract';

/**
 * The live half of canvas presence.
 *
 * Presence has two channels and they answer different questions. `POST /:id/presence`
 * is DURABLE: who is a member, what revision they are on, whether the room is over
 * its realtime-editor quota — facts a reload must not lose, and facts that are still
 * true eight seconds later. The relay is EPHEMERAL: where a pointer is right now.
 * Putting a pointer on the durable channel is what made a collaborator's cursor up
 * to eight seconds stale and cost a `creation_session_members.cursor` write per tick.
 *
 * So this module holds only the ephemeral half — a map keyed by user id, fed by
 * relayed frames and merged over the roster the poll already returns. Nothing here
 * is persisted, and everything expires: a peer whose socket dies without a `leave`
 * frame stops being drawn on its own.
 *
 * `mergeLivePresence` is deliberately a pure function over the roster rather than a
 * second source of members. The roster owns identity (display name, role); the relay
 * owns position. One list is drawn, so a name and a pointer can never disagree.
 */

/** One peer's last known ephemeral state, with the instant it arrived. */
export interface LivePresenceEntry extends CanvasPresenceState {
  atMs: number;
  /**
   * The relay socket the last frame came from. A `leave` frame names a SOCKET,
   * not a person, so this is what resolves it back to whose cursor to retire —
   * and it is why a person with two tabs open only loses their pointer when the
   * tab that was actually moving it goes away.
   */
  socketId?: string;
}

export type LivePresenceMap = Readonly<Record<string, LivePresenceEntry>>;

/**
 * How long a pointer survives without a frame. A still pointer sends nothing, so
 * this is not "how often peers talk" — it is how long a pointer stays on screen
 * after its owner's socket dies WITHOUT a close frame (a laptop lid, a dropped
 * network). Short enough that a ghost is not left standing, long enough that a
 * collaborator who is reading rather than moving does not blink out.
 */
export const LIVE_PRESENCE_TTL_MS = 30_000;

/** The shape a relayed frame arrives in. Re-exported so callers need one import. */
export type { CanvasPresenceFrame, CanvasPresenceState };

/** True when this frame is the canvas relay's presence frame. */
export function isPresenceFrame(frame: unknown): frame is CanvasPresenceFrame {
  return !!frame && typeof frame === 'object' && (frame as { type?: unknown }).type === CANVAS_PRESENCE_FRAME;
}

/**
 * Fold a relayed frame into the map. Returns the SAME map when the frame carries
 * nothing usable, so a caller can `setState(next => apply(next, …))` without
 * re-rendering on noise.
 *
 * The frame is re-validated with the contract's own sanitizer even though the
 * server already applied it: this end has no way to know which server it is
 * talking to, and the cost of agreeing with the relay by construction is one
 * function call.
 */
export function applyPresenceFrame(map: LivePresenceMap, frame: CanvasPresenceFrame, nowMs: number): LivePresenceMap {
  const userId = typeof frame.userId === 'string' ? frame.userId : '';
  if (!userId) return map;
  const state = canvasPresenceFrame(frame);
  if (!state) return map;
  // Frames are partial: a viewport-only frame must not erase a cursor, and a
  // cursor-only frame must not erase the viewport the follower is tracking.
  const socketId = typeof frame.from === 'string' ? frame.from : map[userId]?.socketId;
  return { ...map, [userId]: { ...map[userId], ...state, atMs: nowMs, socketId } };
}

/** Forget a peer outright (they sent a `leave`, or the socket closed). */
export function dropPresence(map: LivePresenceMap, userId: string): LivePresenceMap {
  if (!(userId in map)) return map;
  const next = { ...map };
  delete next[userId];
  return next;
}

/** Drop anyone who has not been heard from within {@link LIVE_PRESENCE_TTL_MS}. */
export function expirePresence(map: LivePresenceMap, nowMs: number, ttlMs = LIVE_PRESENCE_TTL_MS): LivePresenceMap {
  const live = Object.entries(map).filter(([, entry]) => nowMs - entry.atMs < ttlMs);
  return live.length === Object.keys(map).length ? map : Object.fromEntries(live);
}

/** The minimum a member row needs for the merge; the real one carries much more. */
export interface PresenceMember {
  userId: string;
  cursor?: { x?: number; y?: number } | null;
  viewport?: Record<string, unknown> | null;
  typing?: boolean;
}

/**
 * Overlay live state onto the roster.
 *
 * A peer with no roster row yet — they connected between two polls — is APPENDED
 * rather than dropped, because the whole point of the relay is that it is faster
 * than the poll. Such a row has no display name, which the cursor layer already
 * renders as the generic "collaborator" label until the next poll names them.
 */
export function mergeLivePresence<T extends PresenceMember>(
  members: readonly T[],
  live: LivePresenceMap,
  currentUserId: string | null,
): T[] {
  const seen = new Set<string>();
  const merged = members.map((member) => {
    seen.add(member.userId);
    const entry = live[member.userId];
    if (!entry || member.userId === currentUserId) return member;
    return {
      ...member,
      ...(entry.cursor !== undefined ? { cursor: entry.cursor } : {}),
      ...(entry.viewport ? { viewport: entry.viewport } : {}),
      ...(entry.typing !== undefined ? { typing: entry.typing } : {}),
    };
  });
  for (const [userId, entry] of Object.entries(live)) {
    if (seen.has(userId) || userId === currentUserId) continue;
    merged.push({ userId, cursor: entry.cursor ?? null, viewport: entry.viewport, typing: entry.typing } as unknown as T);
  }
  return merged;
}

/**
 * The smallest interval between outbound pointer frames.
 *
 * 20 frames a second reads as continuous motion and leaves the server's 30/s
 * token bucket (see `PeerRelay`) with headroom for the viewport and typing frames
 * that share the channel. Sending on every `pointermove` would spend the bucket
 * on frames no one can perceive.
 */
export const PRESENCE_SEND_INTERVAL_MS = 50;
