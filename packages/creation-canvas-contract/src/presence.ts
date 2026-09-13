/**
 * Live presence — the ONE frame a canvas peer may put on the wire.
 *
 * The canvas WebSocket was deliberately domain-free: a `{type:"changed"}` ping
 * and nothing else, "so there is nothing here that could leak across segments".
 * Carrying a pointer at pointer speed means a client→client relay, and the way
 * that keeps the original property is not trust — it is SHAPE. `canvasPresenceFrame`
 * is a total function from anything a socket sends to at most this fixed record of
 * ephemeral view state, and the relay forwards its output rather than the input.
 * A field that is not declared here cannot cross the relay, whatever a client puts
 * in the frame.
 *
 * Declared in the contract package because both ends must agree exactly: the
 * Durable Object sanitizes with this function, and the canvas merges the result
 * onto the member roster it already holds. Two copies would drift the moment one
 * side added a field, and the drift would look like "cursors stopped working".
 *
 * Everything here is EPHEMERAL. Nothing is persisted by the relay — the durable
 * record of who is in a session stays with `POST /:id/presence`, which is also the
 * fallback when the socket cannot be established.
 */

/** The canvas relay's single client frame type. */
export const CANVAS_PRESENCE_FRAME = 'canvas.presence' as const;

/** A point in FLOW coordinates (not screen pixels) — see `RemoteCursors`. */
export interface CanvasPresencePoint { x: number; y: number }

export interface CanvasPresenceViewport { x: number; y: number; zoom: number }

/**
 * Where a peer's BODY is, when the surface they are on has one.
 *
 * ── WHY THIS IS A FIELD AND NOT A SECOND FRAME ──────────────────────────────
 * A cursor and a walker are the same question — "where is this person right
 * now" — asked by two surfaces. Giving the spatial answer its own frame type
 * would mean a second relay allow-list entry, a second sanitizer, a second
 * client map and a second TTL, all of which could disagree about whether
 * somebody is still here. The room and the board therefore share ONE ephemeral
 * channel, and a surface reads the component it understands.
 *
 * `position` is in world units (metres), `yaw` in radians about the Y axis —
 * the same units `CanvasWorldTransform` uses, so a walker's transform and a
 * relayed one need no conversion. `seat` is the ring index a person is sitting
 * in when they have not walked away from the table; absent means standing.
 */
export interface CanvasPresenceSpatial {
  position: [number, number, number];
  yaw: number;
  seat?: number;
  /**
   * WHICH space the body is in, when it is not the room itself — the id of the
   * level (a Roblox place) being played. Absent means the room. Two people in the
   * same session can be in different spaces at once, and a body drawn in the wrong
   * one is a stranger standing inside a wall; each space draws only its own.
   */
  space?: string;
}

/**
 * A Brain turn this peer started and is still waiting on.
 *
 * The run itself executes in the requester's browser, so without this every other
 * person on the board saw an idle Brain for the minutes a long turn takes — the
 * transcript only moved when the reply finally landed. It is presence, not board
 * state: it describes what one person is doing right now and dies with their socket.
 * Only the start instant crosses the relay — never the prompt — so the elapsed clock
 * every viewer shows is the same clock.
 */
export interface CanvasPresenceBrainRun {
  /** Epoch ms the turn began, on the requester's clock. */
  startedAt: number;
}

/** What one peer is doing right now. Every field is optional and short-lived. */
export interface CanvasPresenceState {
  /** Pointer position, or null when the pointer left the board. */
  cursor?: CanvasPresencePoint | null;
  /** Pan/zoom, so "follow" tracks live rather than at poll speed. */
  viewport?: CanvasPresenceViewport;
  /** Composing a prompt. */
  typing?: boolean;
  /** Body position on a spatial surface, or null when they left it. */
  spatial?: CanvasPresenceSpatial | null;
  /** A Brain turn in flight, or null when it settled. */
  brainRun?: CanvasPresenceBrainRun | null;
}

/** A relayed frame: the sender's state, plus the identity the SERVER stamped. */
export interface CanvasPresenceFrame extends CanvasPresenceState {
  type: typeof CANVAS_PRESENCE_FRAME;
  /** Room-local socket id, assigned by the relay. */
  from?: string;
  /** `users.id` of the sender, asserted by the authed route — never by the client. */
  userId?: string;
}

/** Largest coordinate accepted. A board is finite; NaN/Infinity are not points. */
const COORD_LIMIT = 1_000_000;

function finite(value: unknown, limit = COORD_LIMIT): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

function point(value: unknown): CanvasPresencePoint | null {
  if (!value || typeof value !== 'object') return null;
  const x = finite((value as CanvasPresencePoint).x);
  const y = finite((value as CanvasPresencePoint).y);
  return x === null || y === null ? null : { x, y };
}

/**
 * Narrow a body position. A room is metres across, not kilometres, so an
 * out-of-range coordinate is a bug or an attack rather than a far-away peer —
 * either way it is dropped, and the caller treats that as "left the surface".
 */
const WORLD_LIMIT = 10_000;

function spatial(value: unknown): CanvasPresenceSpatial | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.position) || raw.position.length !== 3) return null;
  const x = finite(raw.position[0], WORLD_LIMIT);
  const y = finite(raw.position[1], WORLD_LIMIT);
  const z = finite(raw.position[2], WORLD_LIMIT);
  const yaw = finite(raw.yaw, Math.PI * 4);
  if (x === null || y === null || z === null || yaw === null) return null;
  // A seat is a ring index, so it is a small non-negative integer or nothing.
  const seat = finite(raw.seat, 1_000);
  const seated = seat !== null && Number.isInteger(seat) && seat >= 0;
  // A space is an object id: short, and only the characters an id is made of, so
  // the relay cannot be used to carry arbitrary text between peers.
  const space = typeof raw.space === 'string' && /^[A-Za-z0-9_:.-]{1,80}$/.test(raw.space) ? raw.space : null;
  return { position: [x, y, z], yaw, ...(seated ? { seat } : {}), ...(space ? { space } : {}) };
}

/** Latest instant a run may claim to have started — centuries out, short of a garbage value. */
const EPOCH_LIMIT_MS = 1e13;

function brainRun(value: unknown): CanvasPresenceBrainRun | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const startedAt = finite((value as CanvasPresenceBrainRun).startedAt, EPOCH_LIMIT_MS);
  return startedAt !== null && startedAt > 0 ? { startedAt } : null;
}

/**
 * Narrow anything a client sent to the presence state this relay carries, or null
 * when there is nothing worth relaying.
 *
 * `cursor: null` is MEANINGFUL and is preserved — it is how a peer says its pointer
 * left the board, and dropping it would leave a ghost cursor parked wherever the
 * last move happened to be.
 */
export function canvasPresenceFrame(input: unknown): CanvasPresenceState | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const state: CanvasPresenceState = {};

  if ('cursor' in raw) {
    const cursor = point(raw.cursor);
    // An unparseable cursor is treated as "no pointer" rather than dropped, so a
    // malformed frame still retracts a stale one instead of freezing it.
    state.cursor = cursor;
  }

  if (raw.viewport && typeof raw.viewport === 'object') {
    const at = point(raw.viewport);
    const zoom = finite((raw.viewport as CanvasPresenceViewport).zoom, 1_000);
    if (at && zoom !== null && zoom > 0) state.viewport = { ...at, zoom };
  }

  if (typeof raw.typing === 'boolean') state.typing = raw.typing;

  // Same rule the cursor follows: an unparseable body is "left the surface"
  // rather than a dropped field, so a malformed frame retracts a stale avatar
  // instead of leaving it standing in the room forever.
  if ('spatial' in raw) state.spatial = spatial(raw.spatial);

  // Same rule again: a settled run is announced as `null`, and an unparseable one
  // reads as settled, so nobody is left watching a Brain that stopped long ago.
  if ('brainRun' in raw) state.brainRun = brainRun(raw.brainRun);

  return Object.keys(state).length ? state : null;
}
