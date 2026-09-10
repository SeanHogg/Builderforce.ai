import type { CanvasPresenceSpatial } from '@builderforce/creation-canvas-contract';

/**
 * WHERE EVERYBODY STANDS — the room's geometry, as arithmetic.
 *
 * ── WHY THIS IS NOT IN THE SCENE COMPONENT ───────────────────────────────────
 * "Six people around a table" is a layout decision, and layout decisions that
 * live inside a renderer can only be checked by looking at them. A ring, a
 * table that fits inside it, a back wall the session can hang on and a camera
 * that can see all three are four numbers that have to agree; here they agree
 * in one file that a test can read, and `RoomScene` only draws what this
 * returns. Where the SESSION sits among them is the same kind of arithmetic,
 * kept in its own module — see `roomSession.ts`.
 *
 * It is also what keeps the room honest about presence. A seat is where a
 * person is when the relay has NOT heard from them — the deterministic fallback
 * — and a relayed body overrides it. Both paths produce the same `RoomSeat`
 * shape, so the renderer has no branch for "live" versus "assumed" and cannot
 * draw the two differently by accident.
 *
 * Units are metres and radians, matching `CanvasWorldTransform` and
 * `CanvasPresenceSpatial`, so nothing here converts anything.
 */

/** Radius of the table itself. A standup table, not a boardroom slab. */
export const ROOM_TABLE_RADIUS = 1.35;
/** Height of the table top off the floor. */
export const ROOM_TABLE_HEIGHT = 0.74;
/** Radius of the ring of bodies. Far enough out to leave room to stand. */
export const ROOM_SEAT_RADIUS = 2.35;
/** Eye height of a seated body, used to aim the camera at faces not feet. */
export const ROOM_EYE_HEIGHT = 1.35;
/** Square floor edge length. */
export const ROOM_FLOOR_SIZE = 14;
/** Where the back wall stands, on -Z. Inside the floor, behind the ring. The one
 *  place in the room the session can hang rather than rest. */
export const ROOM_WALL_Z = -5.2;

/** One transform on the ring: where a body stands, and which way it faces. */
export interface RoomPlacement {
  position: [number, number, number];
  /** Radians about Y. Three.js yaw 0 faces -Z, so this aims a body at the table. */
  yaw: number;
}

/**
 * The `index`-th of `count` places on the ring.
 *
 * The first seat sits on +Z — nearest the default camera — so a room of one
 * puts that person where the viewer is already looking rather than behind them.
 * Facing is derived, never stored: a body on the ring always looks inward, and
 * a seat that could face outward is a seat that can be wrong.
 */
export function seatPlacement(index: number, count: number, radius = ROOM_SEAT_RADIUS): RoomPlacement {
  const total = Math.max(1, count);
  const angle = (index / total) * Math.PI * 2;
  return {
    position: [Math.sin(angle) * radius, 0, Math.cos(angle) * radius],
    yaw: angle,
  };
}

/** The minimum a roster row needs to be seated. The real one carries more. */
export interface RoomOccupant {
  userId: string;
  displayName?: string | null;
}

export interface RoomSeat {
  userId: string;
  /** Empty when the roster has not named them yet — the surface labels those. */
  displayName: string;
  /** Ring index. Stable for a given roster order, which is what stops the
   *  circle reshuffling every time somebody's cursor moves. */
  index: number;
  position: [number, number, number];
  yaw: number;
  /** True when a relay frame put this body here, false when the ring did. */
  live: boolean;
  /** True for the viewer's own seat, so the renderer can mark it. */
  isSelf: boolean;
}

/**
 * Seat the roster, letting live bodies override their own chairs.
 *
 * Order is the roster's order, deliberately: it is stable across polls, whereas
 * sorting by name would move everyone whenever somebody was renamed, and
 * sorting by arrival would move everyone whenever anybody rejoined.
 *
 * A peer whose relayed `seat` names a DIFFERENT chair than the roster gave them
 * is honoured, because they are the authority on where they are; their ring
 * position is recomputed from the seat they claim rather than from their row.
 */
export function assignRoomSeats(
  occupants: readonly RoomOccupant[],
  live: ReadonlyMap<string, CanvasPresenceSpatial>,
  currentUserId: string | null,
): RoomSeat[] {
  const count = occupants.length;
  return occupants.map((occupant, index) => {
    const body = live.get(occupant.userId);
    const seatIndex = body?.seat !== undefined ? body.seat : index;
    const fallback = seatPlacement(seatIndex, count);
    return {
      userId: occupant.userId,
      displayName: occupant.displayName ?? '',
      index: seatIndex,
      position: body ? body.position : fallback.position,
      yaw: body ? body.yaw : fallback.yaw,
      live: !!body,
      isSelf: occupant.userId === currentUserId,
    };
  });
}

/**
 * The room's palette, per theme.
 *
 * WebGL materials cannot read a CSS custom property, so the app's token system
 * stops at the canvas edge and something has to carry the two themes across it.
 * A declared pair is that something: one place both themes are stated, checked
 * by eye once rather than derived from a computed style at runtime — which
 * would also mean re-reading the document on every theme flip and re-uploading
 * every material. The DOM chrome around the canvas still uses the real tokens.
 */
export interface RoomPalette {
  sky: string;
  floor: string;
  wall: string;
  table: string;
  panel: string;
  /** Ring under an empty chair. */
  chair: string;
  /** Body colour for a peer with no colour of their own. */
  body: string;
  /** Body colour for the viewer, so you can find yourself. */
  self: string;
  /** HSL lightness generated bodies use, so they read at the same weight
   *  against this theme's ground. */
  bodyLightness: number;
  ambient: number;
  sun: number;
}

export const ROOM_PALETTES: Readonly<Record<'light' | 'dark', RoomPalette>> = {
  light: {
    sky: '#dbe3f0', floor: '#c9d1de', wall: '#e6ebf3', table: '#9aa6ba',
    panel: '#f6f8fb', chair: '#aab4c4', body: '#4c6ef5', self: '#0ca678',
    bodyLightness: 46, ambient: 0.72, sun: 0.85,
  },
  dark: {
    sky: '#141821', floor: '#1e2430', wall: '#232a37', table: '#39424f',
    panel: '#2b3340', chair: '#39424f', body: '#7c83fd', self: '#34d399',
    bodyLightness: 62, ambient: 0.5, sun: 0.7,
  },
};

/**
 * A stable colour for one person, so the same body is the same colour in every
 * session and for every viewer. Derived from the user id rather than assigned
 * on arrival, which is what stops two clients disagreeing about who is blue.
 */
export function bodyColor(userId: string, palette: RoomPalette, isSelf: boolean): string {
  if (isSelf) return palette.self;
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) % 360;
  // Fixed saturation, theme-chosen lightness, so every body reads at the same
  // weight against its own ground; only the hue varies between people.
  return `hsl(${hash}, 58%, ${palette.bodyLightness}%)`;
}
