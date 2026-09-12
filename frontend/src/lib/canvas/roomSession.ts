import type { Canvas3DScene } from '@/lib/canvas/canvas3d';
import { CANVAS_3D_LAYER_GAP } from '@/lib/canvas/canvas3d';
import { ROOM_FLOOR_SIZE, ROOM_TABLE_HEIGHT, ROOM_TABLE_RADIUS, ROOM_WALL_Z } from './roomSeating';
import type { RoomSpot } from './roomSpots';

/**
 * THE SESSION IN THE ROOM — where it sits, and what it looks like from across a table.
 *
 * ── WHY THE 3D SPACE AND THE ROOM ARE ONE SURFACE ────────────────────────────
 * They used to be two rail entries: "3D space" projected the board's objects through
 * depth, and "Room" seated the people with a capped wall of the same objects behind
 * them. Two 3D readings of one board, two cameras, two ways of drawing the same
 * card — and a visitor pressing one could not see the other. The room is now the
 * ONE spatial surface, and the session is a THING in it: a diorama of the board,
 * placed on the table, the floor or the wall, that opens into the full depth
 * projection when pressed and minimises back to where it was left.
 *
 * ── WHY THIS IS NOT IN THE SCENE COMPONENT ───────────────────────────────────
 * Same reason `roomSeating.ts` exists: "on the table if it is within the table's
 * reach, on the wall if it is against it, otherwise on the floor" is a layout rule,
 * and a layout rule inside a renderer can only be checked by looking at it. Here it
 * is arithmetic a test reads, and the diorama component only draws what it returns.
 *
 * Units are metres and radians, matching the rest of the room.
 */

export type RoomSessionAnchor = 'table' | 'floor' | 'wall';

/** Widest edge of the diorama, in metres, whichever anchor it sits on. */
export const ROOM_SESSION_FOOTPRINT = 1.6;
/** Vertical gap between two depth layers of the diorama. */
export const ROOM_SESSION_LAYER_STEP = 0.14;
/** How close to the back wall a placement has to be to hang there instead. */
export const ROOM_SESSION_WALL_REACH = 1.2;
/** Centre height of a wall-hung session, so it reads at eye level from the ring. */
export const ROOM_SESSION_WALL_HEIGHT = 2.0;
/** Lift above whatever the diorama sits on, so its base never z-fights the top. */
const REST_LIFT = 0.05;
/** Keep a floor placement inside the floor, and off the ring's outermost chairs. */
const FLOOR_MARGIN = 1.0;
/**
 * How many cards keep their picture. A board with four hundred generated images is
 * four hundred texture uploads for a diorama the size of a tray; past this the cards
 * carry their colour, which is still the board's shape — and the full projection one
 * press away draws every picture anyway.
 */
export const ROOM_SESSION_PREVIEW_CAPACITY = 24;

export interface RoomSessionPlacement {
  anchor: RoomSessionAnchor;
  /** Where the diorama's own origin sits in the room. */
  position: [number, number, number];
  /** Euler XYZ, radians. Flat on a table or the floor; upright on the wall. */
  rotation: [number, number, number];
}

/**
 * The two numbers a person actually chooses — everything else is derived. The same
 * spot every creation in the room keeps; stored through `roomSpots.ts`.
 */
export type RoomSessionSpot = RoomSpot;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Turn a point on the floor plane into a placement.
 *
 * The anchor is DERIVED from the point, never stored beside it: a spot inside the
 * table's radius is on the table, one against the back wall hangs on it, and the
 * rest of the floor is the floor. That is what lets a drag be one gesture — the
 * diorama climbs onto the table as it crosses the edge — and what stops a stored
 * placement from ever disagreeing with itself.
 */
export function placeSessionInRoom({ x, z }: RoomSessionSpot): RoomSessionPlacement {
  const half = ROOM_FLOOR_SIZE / 2 - FLOOR_MARGIN;
  const cx = clamp(Number.isFinite(x) ? x : 0, -half, half);
  const cz = clamp(Number.isFinite(z) ? z : 0, ROOM_WALL_Z, half);

  if (Math.hypot(cx, cz) <= ROOM_TABLE_RADIUS) {
    return { anchor: 'table', position: [cx, ROOM_TABLE_HEIGHT + REST_LIFT, cz], rotation: [-Math.PI / 2, 0, 0] };
  }
  if (cz <= ROOM_WALL_Z + ROOM_SESSION_WALL_REACH) {
    return { anchor: 'wall', position: [cx, ROOM_SESSION_WALL_HEIGHT, ROOM_WALL_Z], rotation: [0, 0, 0] };
  }
  return { anchor: 'floor', position: [cx, REST_LIFT / 2, cz], rotation: [-Math.PI / 2, 0, 0] };
}

/** Where a session starts out: the middle of the table. */
export const DEFAULT_ROOM_SESSION_SPOT: RoomSessionSpot = { x: 0, z: 0 };

/** One board object, shrunk to the diorama. Local frame: x right, y up the sheet, z out of it. */
export interface RoomSessionCard {
  id: string;
  label: string;
  /** The card's own accent; absent, the diorama paints the palette's card face. */
  color?: string | undefined;
  preview?: string | undefined;
  position: [number, number, number];
  width: number;
  height: number;
}

/** One depth plane of the diorama, drawn as a plate under its cards. */
export interface RoomSessionPlate {
  index: number;
  z: number;
  /** Objects on this plane — a label the caption can count with. */
  count: number;
}

export interface RoomSessionDiorama {
  /** Metres per board pixel. */
  scale: number;
  width: number;
  height: number;
  /** Distance from the base plate to the furthest-out card. */
  depth: number;
  cards: readonly RoomSessionCard[];
  plates: readonly RoomSessionPlate[];
}

/**
 * Shrink the board's depth projection to something that fits on a table.
 *
 * It reads the SAME {@link Canvas3DScene} the full-size view draws, so the diorama
 * is the projection at a distance rather than a second opinion about where each
 * object is: the layers are the same layers, the floating offsets the same offsets.
 * Board pixels become metres by one scale, chosen so the longest edge is the
 * footprint; depth is stepped per layer rather than scaled, because 340px between
 * planes at that scale is a stack nobody could see.
 */
export function roomSessionDiorama(scene: Canvas3DScene, footprint = ROOM_SESSION_FOOTPRINT): RoomSessionDiorama {
  const longest = Math.max(scene.plane.width, scene.plane.height, 1);
  const scale = footprint / longest;
  const layerStep = ROOM_SESSION_LAYER_STEP;

  const cards: RoomSessionCard[] = scene.cards.map((card, index) => ({
    id: card.id,
    label: card.label,
    color: card.accent,
    preview: index < ROOM_SESSION_PREVIEW_CAPACITY ? card.preview : undefined,
    position: [
      card.x * scale,
      // The board's y grows downward; the sheet's grows upward.
      -card.y * scale,
      card.layer * layerStep + ((card.z - card.layerZ) / CANVAS_3D_LAYER_GAP) * layerStep,
    ],
    width: Math.max(0.02, card.width * scale),
    height: Math.max(0.02, card.height * scale),
  }));

  const plates: RoomSessionPlate[] = scene.layers.map((layer) => ({
    index: layer.index,
    z: layer.index * layerStep,
    count: layer.count,
  }));

  const depth = cards.reduce((deepest, card) => Math.max(deepest, card.position[2]), 0);

  return {
    scale,
    width: scene.plane.width * scale,
    height: scene.plane.height * scale,
    depth,
    cards,
    plates,
  };
}
