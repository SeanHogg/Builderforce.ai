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

/** What one peer is doing right now. Every field is optional and short-lived. */
export interface CanvasPresenceState {
  /** Pointer position, or null when the pointer left the board. */
  cursor?: CanvasPresencePoint | null;
  /** Pan/zoom, so "follow" tracks live rather than at poll speed. */
  viewport?: CanvasPresenceViewport;
  /** Composing a prompt. */
  typing?: boolean;
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

  return Object.keys(state).length ? state : null;
}
