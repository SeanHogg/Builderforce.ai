import { resourceIdOfType } from '@builderforce/creation-canvas-contract';
import { CANVAS_WIDGET_RESOURCE_TYPE } from '@builderforce/canvas-widget-protocol';
import { auditsKind } from '@/lib/academic/accessibility';
import { boardMetricDefinitions } from './boardMetrics';
import { placeCreationInRoom } from './roomCreations';
import type { RoomSessionPlacement } from './roomSession';
import type { RoomSpot } from './roomSpots';

/**
 * STATIONS — the working things that stand in the room: a desk where changes are
 * signed off, a board of the session's metrics, a third-party widget on a stand.
 *
 * ── WHY THEY ARE IN THE ROOM ─────────────────────────────────────────────────
 * Operator decision 2026-09-12: canvas features that were built and unreachable are
 * surfaces IN THE ROOM, not pages beside it. A creation (`roomCreations.ts`) is a
 * thing the session MADE; a station is a thing the session USES. Both stand in the
 * one spatial surface, are dragged the same way, remember where this viewer left
 * them, and open into a 2D reading from their own caption — which is also the
 * accessible path, and the whole room on a device without WebGL.
 *
 * ── HOW A STATION JOINS (OPEN/CLOSED) ────────────────────────────────────────
 * One entry in {@link ROOM_STATION_SPECS} says WHEN it stands in the room (from the
 * board's objects alone — pure, so a test reads it), and one entry in the view
 * registry (`components/creation-canvas/room-stations/registry.tsx`) says what it
 * looks like and what its panel does. Nothing in the room branches on a station id,
 * so a new station — the academic set is next — is two entries, not an edit to the
 * room.
 *
 * Units are metres and radians, matching the rest of the room.
 */

export interface RoomStationObject {
  id: string;
  data: Record<string, unknown>;
}

/** One station standing in the room. A single-instance station has no `objectId`;
 *  a per-object one (a widget placement) stands once per object. */
export interface RoomStationInstance {
  /** Stable across renders and viewers — keys the stand's remembered spot. */
  key: string;
  station: string;
  objectId?: string;
  /** The external record a per-object station points at (a widget's registry id). */
  resourceId?: string;
  /** The object's own title, when the station stands for one. */
  title?: string;
}

export interface RoomStationSpec {
  id: string;
  /** Which instances of this station stand in the room for this board. */
  instances: (objects: readonly RoomStationObject[]) => RoomStationInstance[];
}

function titleOf(data: Record<string, unknown>): string {
  return typeof data.title === 'string' ? data.title.trim() : '';
}

export const ROOM_STATION_SPECS: readonly RoomStationSpec[] = [
  // Always in the room: an empty desk is how somebody learns that changes to money-
  // bearing figures wait for a signature at all. Its view decides who may USE it.
  { id: 'approvals', instances: () => [{ key: 'approvals', station: 'approvals' }] },
  // Only once the session defines a metric — an empty metrics board is furniture.
  {
    id: 'metrics',
    instances: (objects) => (boardMetricDefinitions(objects).length ? [{ key: 'metrics', station: 'metrics' }] : []),
  },
  // One stand per placement. A placement is any board object whose resource is a
  // registered widget — the protocol's rule, not a new object kind.
  {
    id: 'widget',
    instances: (objects) => objects.flatMap((object) => {
      const widgetId = resourceIdOfType(object.data.resourceId, CANVAS_WIDGET_RESOURCE_TYPE);
      return widgetId
        ? [{ key: `widget:${object.id}`, station: 'widget', objectId: object.id, resourceId: widgetId, title: titleOf(object.data) }]
        : [];
    }),
  },
  // TEACHING AND SCHOLARSHIP. Each stands only once the board holds what it reads — a
  // gradebook board in a room with no gradebook is furniture, as the metrics board is.
  whenAnyKind('assessment', ['assignment']),
  whenAnyKind('gradebook', ['gradebook']),
  // Whatever the audit has rules for (`auditsKind`), so the station and the findings
  // cannot disagree about what is audited.
  { id: 'accessibility', instances: (objects) => (objects.some((object) => auditsKind(String(object.data.kind ?? ''))) ? [{ key: 'accessibility', station: 'accessibility' }] : []) },
  whenAnyKind('citations', ['citation', 'bibliography']),
];

/** A single-instance station that stands while any object of one of `kinds` is on the board. */
function whenAnyKind(id: string, kinds: readonly string[]): RoomStationSpec {
  return { id, instances: (objects) => (objects.some((object) => kinds.includes(String(object.data.kind ?? ''))) ? [{ key: id, station: id }] : []) };
}

/** Every station standing in the room for this board, in registry order. */
export function roomStationInstances(
  objects: readonly RoomStationObject[],
  specs: readonly RoomStationSpec[] = ROOM_STATION_SPECS,
): RoomStationInstance[] {
  return specs.flatMap((spec) => spec.instances(objects));
}

/** Stations line the two side walls, clear of the ring and of the creation rows. */
export const ROOM_STATION_SIDE_X = 5.2;
export const ROOM_STATION_FIRST_Z = -1.6;
export const ROOM_STATION_STEP_Z = 2.0;
/** Per side, before a station starts a second, nearer line. */
export const ROOM_STATION_SIDE_CAPACITY = 3;
export const ROOM_STATION_INNER_X = 3.9;

/**
 * Where the `index`-th station stands until somebody moves it: alternating left and
 * right along the side walls, front to back, then a nearer line inside the first.
 */
export function defaultRoomStationSpot(index: number): RoomSpot {
  const safe = Math.max(0, Math.floor(Number.isFinite(index) ? index : 0));
  const side = safe % 2 === 0 ? -1 : 1;
  const slot = Math.floor(safe / 2);
  const line = Math.floor(slot / ROOM_STATION_SIDE_CAPACITY);
  const along = slot % ROOM_STATION_SIDE_CAPACITY;
  const x = side * (line === 0 ? ROOM_STATION_SIDE_X : ROOM_STATION_INNER_X);
  return { x, z: ROOM_STATION_FIRST_Z + along * ROOM_STATION_STEP_Z };
}

/**
 * A spot, placed — the creation's rule (the same table and wall reach), then turned
 * to face the table, because a station is something you walk UP to and read: its face
 * pointing at the wall would be a stand showing everyone its back.
 */
export function placeStationInRoom(spot: RoomSpot): RoomSessionPlacement {
  const placed = placeCreationInRoom(spot);
  if (placed.anchor === 'wall') return placed;
  const [x, , z] = placed.position;
  const yaw = Math.abs(x) < 1e-6 && Math.abs(z) < 1e-6 ? 0 : Math.atan2(-x, -z);
  return { ...placed, rotation: [0, yaw, 0] };
}
