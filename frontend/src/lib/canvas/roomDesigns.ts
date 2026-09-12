import {
  ROOM_LAYOUT_CUSTOM,
  roomDesignOf,
  roomDesignSummary,
  type CanvasRoomDesign,
} from '@builderforce/creation-canvas-contract';

/**
 * WHICH ROOM THE SESSION MEETS IN — read off the board.
 *
 * ── WHY THE DESIGN IS AN OBJECT AND NOT A SESSION SETTING ────────────────────
 * A `room` is a thing somebody made: it has a title, it is edited like any other
 * card, Brain patches it through the same mutable-field door, and the marketplace
 * snapshots it the way it snapshots a game. Every one of those already works for
 * an OBJECT and none of them exists for a session column. So the room the session
 * meets in is a `room` object on its board, and this module is the one place that
 * says WHICH, when there are several.
 *
 * ── WHY "LATEST CHOSEN", NOT A FLAG ──────────────────────────────────────────
 * A boolean `active` on each room object is two writers away from two active rooms.
 * `activatedAt` is one fact per object — when it was last chosen — and the room in
 * use is the newest of them, derived. Choosing a room is one write to one object;
 * nothing has to be cleared on the others, and two people choosing at once resolve
 * by the clock rather than by whoever wrote last.
 */

export interface RoomDesignObject {
  id: string;
  title: string;
  design: CanvasRoomDesign;
  /** `custom`, or the preset id it still matches. */
  layout: string;
  activatedAt: string | null;
  pieces: number;
  seats: number;
}

interface BoardObjectLike {
  id: string;
  data: Record<string, unknown>;
}

function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** Every room design on the board, in board order. */
export function roomDesignObjectsOf(objects: readonly BoardObjectLike[]): RoomDesignObject[] {
  return objects.flatMap((object): RoomDesignObject[] => {
    if (object.data.kind !== 'room') return [];
    const design = roomDesignOf(object.data);
    const summary = roomDesignSummary(design);
    return [{
      id: object.id,
      title: typeof object.data.title === 'string' ? object.data.title.trim() : '',
      design,
      layout: design.layout || ROOM_LAYOUT_CUSTOM,
      activatedAt: isoOrNull(object.data.activatedAt),
      pieces: summary.pieces,
      seats: summary.seats,
    }];
  });
}

/**
 * The room in use: the most recently chosen, else the first on the board, else
 * null — and null means the standup room, which the caller supplies.
 */
export function activeRoomDesign(rooms: readonly RoomDesignObject[]): RoomDesignObject | null {
  if (rooms.length === 0) return null;
  let chosen: RoomDesignObject | null = null;
  for (const room of rooms) {
    if (!room.activatedAt) continue;
    if (!chosen || !chosen.activatedAt || Date.parse(room.activatedAt) > Date.parse(chosen.activatedAt)) chosen = room;
  }
  return chosen ?? rooms[0]!;
}
