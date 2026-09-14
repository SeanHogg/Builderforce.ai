import {
  CANVAS_ROOM_DESIGN_SCHEMA_VERSION,
  MAX_FLOOR,
  MAX_FURNITURE,
  MIN_FLOOR,
  ROOM_FURNITURE_KINDS,
  ROOM_LAYOUT_CUSTOM,
  ROOM_LAYOUT_IDS,
  canvasRoomDesignFrom,
  isRoomLayoutId,
  roomDesignSummary,
  type CanvasRoomDesign,
  type RoomFurniture,
} from '@builderforce/creation-canvas-contract';

/**
 * Why a Brain-authored `room` would land as an empty black box — or null when the
 * patch carries a real layout or a furniture design that survives sanitisation.
 *
 * ── WHY CONTENT IS NOT ENOUGH ────────────────────────────────────────────────
 * `content` is on every kind's mutable list, so the generic empty-shell rule treated
 * a prose description as substantive work. The room then rendered as a black box:
 * `roomDesign` with invented kinds (door / podium / light) is emptied by
 * `canvasRoomDesignFrom`, and any `roomDesign` object wins over `roomLayout`.
 */
export function roomAuthorshipProblem(authored: Record<string, unknown>): string | null {
  const suppliedDesign = authored.roomDesign != null
    && typeof authored.roomDesign === 'object'
    && !Array.isArray(authored.roomDesign);
  if (suppliedDesign) {
    const emptied = emptyRoomDesignProblem(authored.roomDesign);
    if (emptied) return emptied;
    return null;
  }
  if (isRoomLayoutId(authored.roomLayout)) return null;
  return (
    `A room with only a title or content is an empty shell — it lands as a black box. `
    + `Set roomLayout to ${ROOM_LAYOUT_IDS.join(', ')}, send a roomDesign whose furniture `
    + `uses only ${ROOM_FURNITURE_KINDS.join(', ')}, or call canvas_create_room for theater seating. `
    + `Doors, lights and podiums are not furniture kinds — use screen for projection and chair for seats.`
  );
}

/**
 * A supplied `roomDesign` that sanitises to zero furniture — usually because every
 * piece used an invented kind. Name the valid kinds and presets so the model can
 * correct in the same turn rather than landing an empty custom room.
 */
export function emptyRoomDesignProblem(roomDesign: unknown): string | null {
  const design = canvasRoomDesignFrom(roomDesign);
  if (design.furniture.length > 0) return null;
  return (
    `roomDesign sanitized to zero furniture (invalid kinds are dropped). `
    + `Valid furniture kinds: ${ROOM_FURNITURE_KINDS.join(', ')}. `
    + `Valid presets (roomLayout): ${ROOM_LAYOUT_IDS.join(', ')}. `
    + `Doors, lights and podiums are not kinds — use screen for projection, chair for seats. `
    + `Or call canvas_create_room for theater seating.`
  );
}

/** Smallest and largest theater the dedicated tool will build. */
export const THEATER_SEAT_MIN = 2;
export const THEATER_SEAT_MAX = 120;

/**
 * Theater seating for N people: rows of chairs facing a screen on the back wall.
 * Floor clamps to MIN/MAX_FLOOR; furniture caps at MAX_FURNITURE; only valid kinds.
 */
export function buildTheaterRoomDesign(seatCount: number): CanvasRoomDesign {
  const raw = Number.isFinite(seatCount) ? Math.floor(seatCount) : THEATER_SEAT_MIN;
  const seats = Math.min(THEATER_SEAT_MAX, Math.max(THEATER_SEAT_MIN, raw));

  const cols = Math.min(14, Math.max(4, Math.ceil(Math.sqrt(seats * 1.25))));
  const rows = Math.ceil(seats / cols);
  const pitchX = 0.85;
  const pitchZ = 1.0;
  const stageGap = 2.4;

  const width = Math.min(MAX_FLOOR, Math.max(MIN_FLOOR, cols * pitchX + 2.8));
  const depth = Math.min(MAX_FLOOR, Math.max(MIN_FLOOR, rows * pitchZ + stageGap + 2.2));

  const furniture: RoomFurniture[] = [{
    id: 'screen-1',
    kind: 'screen',
    position: [0, 1.5, -depth / 2 + 0.1],
    yaw: 0,
    scale: [1, 1, 1],
  }];

  let placed = 0;
  const frontZ = -depth / 2 + stageGap;
  for (let row = 0; row < rows && placed < seats; row += 1) {
    const z = frontZ + row * pitchZ;
    for (let col = 0; col < cols && placed < seats; col += 1) {
      placed += 1;
      const x = (col - (cols - 1) / 2) * pitchX;
      // yaw 0 faces −Z (toward the screen), matching boardroom near-side chairs.
      furniture.push({
        id: `chair-${placed}`,
        kind: 'chair',
        position: [x, 0, z],
        yaw: 0,
        scale: [1, 1, 1],
      });
    }
  }

  const design = canvasRoomDesignFrom({
    schemaVersion: CANVAS_ROOM_DESIGN_SCHEMA_VERSION,
    layout: ROOM_LAYOUT_CUSTOM,
    floor: { width, depth },
    wall: { height: 4.2 },
    furniture: furniture.slice(0, MAX_FURNITURE),
  });
  // canvasRoomDesignFrom preserves custom layout when furniture is present.
  return { ...design, layout: ROOM_LAYOUT_CUSTOM };
}

/** One-line summary for the tool result so Brain can confirm what landed. */
export function theaterRoomSummary(design: CanvasRoomDesign): { seats: number; pieces: number; area: number } {
  return roomDesignSummary(design);
}
