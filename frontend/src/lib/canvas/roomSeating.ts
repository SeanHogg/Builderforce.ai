import { STANDUP_ROOM, type CanvasPresenceSpatial, type RoomSeatSpot } from '@builderforce/creation-canvas-contract';

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

/*
 * The STANDUP room's numbers — the room every session had before one could be
 * designed — read from the contract's own preset rather than restated, so the
 * default design and these constants cannot drift apart. A DESIGNED room carries
 * its own geometry (`roomDesignGeometry`); these are the fallback and the tests'
 * fixed points.
 */
/** Radius of the table itself. A standup table, not a boardroom slab. */
export const ROOM_TABLE_RADIUS: number = STANDUP_ROOM.tableRadius;
/** Height of the table top off the floor. */
export const ROOM_TABLE_HEIGHT: number = STANDUP_ROOM.tableHeight;
/** Radius of the ring of bodies. Far enough out to leave room to stand. */
export const ROOM_SEAT_RADIUS = 2.35;
/** Where people who found no chair stand: a wider ring, behind whoever is seated. */
export const ROOM_STANDING_RADIUS = 4.0;
/** Eye height of a seated body, used to aim the camera at faces not feet. */
export const ROOM_EYE_HEIGHT = 1.35;
/** Floor width, along X. */
export const ROOM_FLOOR_SIZE: number = STANDUP_ROOM.floorWidth;
/** Where the back wall stands, on -Z. The one place in the room the session can
 *  hang rather than rest. */
export const ROOM_WALL_Z: number = -STANDUP_ROOM.floorDepth / 2;

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

/** A person in the session, or an agent whose card is on the board. */
export type RoomOccupantKind = 'human' | 'agent';

/** The minimum a roster row needs to be seated. The real one carries more. */
export interface RoomOccupant {
  userId: string;
  displayName?: string | null;
  /** Their profile picture, when they have one. Agents and guests usually do not. */
  avatarUrl?: string | null;
  /** Absent means a person. */
  kind?: RoomOccupantKind;
}

export interface RoomSeat {
  userId: string;
  /** Empty when the roster has not named them yet — the surface labels those. */
  displayName: string;
  /** The face drawn on their figure and beside their name; null draws the plain figure. */
  avatarUrl: string | null;
  kind: RoomOccupantKind;
  /** Ring index. Stable for a given roster order, which is what stops the
   *  circle reshuffling every time somebody's cursor moves. */
  index: number;
  position: [number, number, number];
  yaw: number;
  /** True when a relay frame put this body here, false when the ring did. */
  live: boolean;
  /** True for the viewer's own seat, so the renderer can mark it. */
  isSelf: boolean;
  /**
   * Whether this occupant is HERE rather than merely on the roster: a peer the relay
   * has heard from, the viewer (who is reading the room, so is in it), or an agent —
   * which has no browser to relay a body from; its card on the board is its presence.
   * The one answer every count and every dimmed plate reads.
   */
  present: boolean;
}

/**
 * The `index`-th place in a room that may have CHAIRS.
 *
 * A designed room seats people on its furniture, in the order the designer placed
 * it (`roomDesignSeats`); the standup room has none and seats everyone on the ring.
 * Whoever finds no chair — the eleventh person in a ten-chair boardroom — stands on
 * a wider ring behind the seated, rather than on top of the table the ring would
 * otherwise cross. One function, so the room, the roster and the viewer's own
 * announced body all agree about where the `index`-th person is.
 */
export function roomSeatPlacement(index: number, count: number, seats: readonly RoomSeatSpot[]): RoomPlacement {
  const seated = seats[index];
  if (seated) return { position: seated.position, yaw: seated.yaw };
  if (seats.length === 0) return seatPlacement(index, count);
  return seatPlacement(index - seats.length, Math.max(1, count - seats.length), ROOM_STANDING_RADIUS);
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
 *
 * `seats` are the designed room's chairs, if it has any — see `roomSeatPlacement`.
 */
export function assignRoomSeats(
  occupants: readonly RoomOccupant[],
  live: ReadonlyMap<string, CanvasPresenceSpatial>,
  currentUserId: string | null,
  seats: readonly RoomSeatSpot[] = [],
): RoomSeat[] {
  const count = occupants.length;
  return occupants.map((occupant, index) => {
    const body = live.get(occupant.userId);
    const seatIndex = body?.seat !== undefined ? body.seat : index;
    const fallback = roomSeatPlacement(seatIndex, count, seats);
    const kind = occupant.kind ?? 'human';
    const isSelf = occupant.userId === currentUserId;
    return {
      userId: occupant.userId,
      displayName: occupant.displayName ?? '',
      avatarUrl: occupant.avatarUrl || null,
      kind,
      index: seatIndex,
      position: body ? body.position : fallback.position,
      yaw: body ? body.yaw : fallback.yaw,
      live: !!body,
      isSelf,
      present: !!body || isSelf || kind === 'agent',
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
  /** Face of a board card that names no accent, in the session diorama. */
  card: string;
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
    panel: '#f6f8fb', chair: '#aab4c4', card: '#b6c0d0', body: '#4c6ef5', self: '#0ca678',
    bodyLightness: 46, ambient: 0.72, sun: 0.85,
  },
  dark: {
    sky: '#141821', floor: '#1e2430', wall: '#232a37', table: '#39424f',
    panel: '#2b3340', chair: '#39424f', card: '#5a6578', body: '#7c83fd', self: '#34d399',
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
