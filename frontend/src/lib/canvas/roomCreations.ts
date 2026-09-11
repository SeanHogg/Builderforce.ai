import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { MeshFormat } from '@/lib/creativeGeometry';
import type { CreationObjectKind } from '@/domains/canvas/domain/canvasObject';
import { placeSessionInRoom, type RoomSessionPlacement } from './roomSession';
import type { RoomSpot } from './roomSpots';

/**
 * 3D CREATIONS IN THE ROOM — which kinds stand there, and where they stand.
 *
 * ── WHY THEY ARE IN THE ROOM AT ALL ──────────────────────────────────────────
 * The room is the canvas's ONE spatial surface. When it absorbed the "3D space"
 * entry, only the board's depth projection moved in (as the session diorama); a
 * game, a world, an AI scene or a model stayed a flat card that opened into its own
 * full-screen surface — so asking Brain for "a Roblox game" or "a 3D model" never
 * went anywhere near the one place built for things with depth. Now each of those
 * kinds is a THING in the room: it stands on a plinth (or the table, or hangs on
 * the wall), is dragged like the session, and opens from its own button into the
 * surface its kind already has. A model needs no surface: the room is where you
 * walk round it.
 *
 * ── WHY THIS IS NOT IN THE SCENE COMPONENT ───────────────────────────────────
 * The same reason `roomSession.ts` and `roomSeating.ts` exist: where a thing stands
 * before anyone moves it, and which way up it stands, are layout rules — arithmetic a
 * test reads, not something checked by looking at a WebGL canvas.
 *
 * Units are metres and radians, matching the rest of the room.
 */

/**
 * The kinds that stand in the room. Membership is the whole rule: a Brain turn that
 * adds one of these takes the reader to the room, and the room draws every one on
 * the board. A new 3D kind joins by being listed here — nothing else branches on it.
 */
export const ROOM_CREATION_KINDS: ReadonlySet<CreationObjectKind> = new Set<CreationObjectKind>([
  'game', 'world', 'scene', 'model3d',
]);

export function isRoomCreationKind(kind: CreationObjectKind): boolean {
  return ROOM_CREATION_KINDS.has(kind);
}

/** One creation as the room reads it. Built from a board object by `roomCreationsOf`. */
export interface RoomCreation {
  id: string;
  kind: CreationObjectKind;
  /** The object's own title; empty when it has none (the room names it "Untitled"). */
  title: string;
  /** A picture of what it produced, when it has one. */
  preview?: string | undefined;
  /** The mesh it exported, when it exported one — drawn as geometry, not a picture. */
  geometry?: { url: string; format: MeshFormat } | undefined;
  accent?: string | undefined;
  /** The surface it opens into at full size, or null when the room IS its view. */
  surface: CanvasSurfaceId | null;
}

/**
 * What Brain is told when it makes one, so its reply matches where the reader lands.
 * One sentence, shared by every tool that can add a room kind.
 */
export const ROOM_CREATION_TOOL_NOTE = 'It stands in the Room: the canvas takes the reader there as soon as it lands, and the Open button on it plays or edits it at full size.';

/** Metres a model stands tall on its plinth, whatever units its file was written in. */
export const ROOM_MODEL_SIZE = 0.9;
/**
 * The row creations stand in until somebody moves them: behind the ring of chairs and
 * short of the wall's reach, so none starts under a chair or hung on the wall.
 */
export const ROOM_CREATION_ROW_Z = -3.4;
/** A second and later rows stand in front of the ring, this far apart. */
export const ROOM_CREATION_FRONT_Z = 3.4;
export const ROOM_CREATION_FRONT_STEP = 1.3;
/** Centre-to-centre spacing along a row — a plinth's width plus a person's gap. */
export const ROOM_CREATION_SPACING = 1.7;
/** How many stand in one row before the next one starts. */
export const ROOM_CREATION_ROW_CAPACITY = 7;

/**
 * Where the `index`-th creation stands before anyone moves it.
 *
 * Centre-out along the row (0, +1, −1, +2, −2 …) so one creation stands straight
 * behind the table, facing the camera, and the row grows symmetrically. The first row
 * is behind the ring; later rows are in front of it.
 */
export function defaultRoomCreationSpot(index: number): RoomSpot {
  const safe = Math.max(0, Math.floor(Number.isFinite(index) ? index : 0));
  const row = Math.floor(safe / ROOM_CREATION_ROW_CAPACITY);
  const column = safe % ROOM_CREATION_ROW_CAPACITY;
  const offset = column === 0 ? 0 : Math.ceil(column / 2) * (column % 2 === 1 ? 1 : -1);
  const z = row === 0 ? ROOM_CREATION_ROW_Z : ROOM_CREATION_FRONT_Z + (row - 1) * ROOM_CREATION_FRONT_STEP;
  return { x: offset * ROOM_CREATION_SPACING, z };
}

/**
 * A model's triangles as vertex positions for the room.
 *
 * Mesh files are Z-up and the room is Y-up — the same swap the card preview makes
 * (`creativeGeometry.ts`), so a model stands the way its picture shows it. It is then
 * scaled so its largest side is `size` whatever units the file was written in,
 * centred over its stand, and rested on it (lowest point at y = 0). Polygons with
 * more than three corners are fanned into triangles; non-finite corners are dropped.
 * Returns an empty array when there is nothing drawable, so the caller shows the
 * picture instead.
 */
export function fitModelToRoom(
  triangles: readonly { vertices: readonly (readonly [number, number, number])[] }[],
  size = ROOM_MODEL_SIZE,
): Float32Array {
  const points: number[] = [];
  const push = ([mx, my, mz]: readonly [number, number, number]) => { points.push(mx, mz, -my); };
  for (const { vertices } of triangles) {
    const corners = vertices.filter((corner) => corner.every(Number.isFinite));
    for (let index = 1; index + 1 < corners.length; index += 1) {
      push(corners[0]!); push(corners[index]!); push(corners[index + 1]!);
    }
  }
  if (!points.length) return new Float32Array();

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < points.length; index += 1) {
    const axis = index % 3;
    min[axis] = Math.min(min[axis]!, points[index]!);
    max[axis] = Math.max(max[axis]!, points[index]!);
  }
  const extent = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
  const scale = extent > 0 ? size / extent : 1;
  const origin = [(min[0]! + max[0]!) / 2, min[1]!, (min[2]! + max[2]!) / 2];
  const fitted = new Float32Array(points.length);
  for (let index = 0; index < points.length; index += 1) {
    fitted[index] = (points[index]! - origin[index % 3]!) * scale;
  }
  return fitted;
}

/**
 * A spot, placed. The anchor is the session's own rule (`placeSessionInRoom`) — the
 * same table radius, the same wall reach — so a creation and the session climb onto
 * the table at the same edge. What differs is which way up: the session is a SHEET
 * and lies flat, a creation is an OBJECT and always stands upright.
 */
export function placeCreationInRoom(spot: RoomSpot): RoomSessionPlacement {
  return { ...placeSessionInRoom(spot), rotation: [0, 0, 0] };
}
