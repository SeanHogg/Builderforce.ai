// @vitest-environment jsdom
// Creation spots are kept in `localStorage`, which the `lib` project's node environment lacks.
import { beforeEach, describe, expect, it } from 'vitest';
import { ROOM_SEAT_RADIUS, ROOM_WALL_Z } from './roomSeating';
import { ROOM_SESSION_WALL_REACH, placeSessionInRoom } from './roomSession';
import {
  ROOM_CREATION_ROW_CAPACITY, ROOM_CREATION_SPACING, ROOM_MODEL_SIZE,
  defaultRoomCreationSpot, fitModelToRoom, isRoomCreationKind, placeCreationInRoom,
} from './roomCreations';
import { readRoomSpot, roomSpotKey, writeRoomSpot } from './roomSpots';

/**
 * Which things stand in the room and where they first stand are rules, not looks —
 * so they are pinned here rather than by squinting at a WebGL canvas.
 */

describe('isRoomCreationKind', () => {
  it('stands every 3D kind in the room', () => {
    for (const kind of ['game', 'world', 'scene', 'model3d'] as const) expect(isRoomCreationKind(kind)).toBe(true);
  });

  it('leaves every flat kind on the board', () => {
    for (const kind of ['note', 'image', 'website', 'video'] as const) expect(isRoomCreationKind(kind)).toBe(false);
  });
});

describe('defaultRoomCreationSpot', () => {
  const firstRow = Array.from({ length: ROOM_CREATION_ROW_CAPACITY }, (_, index) => defaultRoomCreationSpot(index));

  it('grows the row centre-out, so one creation stands straight behind the table', () => {
    expect(defaultRoomCreationSpot(0).x).toBe(0);
    expect(defaultRoomCreationSpot(1).x).toBeCloseTo(ROOM_CREATION_SPACING);
    expect(defaultRoomCreationSpot(2).x).toBeCloseTo(-ROOM_CREATION_SPACING);
    expect(new Set(firstRow.map((spot) => spot.x.toFixed(3))).size).toBe(firstRow.length);
  });

  it('starts every creation on the floor, clear of the chairs and short of the wall', () => {
    for (const spot of firstRow) {
      expect(placeCreationInRoom(spot).anchor).toBe('floor');
      expect(Math.hypot(spot.x, spot.z)).toBeGreaterThan(ROOM_SEAT_RADIUS + 0.5);
      expect(spot.z).toBeGreaterThan(ROOM_WALL_Z + ROOM_SESSION_WALL_REACH);
    }
  });

  it('starts a second row in front of the ring once the first is full', () => {
    const spot = defaultRoomCreationSpot(ROOM_CREATION_ROW_CAPACITY);
    expect(spot.z).toBeGreaterThan(ROOM_SEAT_RADIUS + 0.5);
    expect(placeCreationInRoom(spot).anchor).toBe('floor');
  });

  it('treats a nonsense index as the first place rather than NaN', () => {
    expect(defaultRoomCreationSpot(Number.NaN)).toEqual(defaultRoomCreationSpot(0));
    expect(defaultRoomCreationSpot(-3)).toEqual(defaultRoomCreationSpot(0));
  });
});

describe('placeCreationInRoom', () => {
  it('uses the session anchor rule but always stands upright', () => {
    for (const spot of [{ x: 0.3, z: 0.2 }, { x: 3, z: 3 }, { x: 0, z: ROOM_WALL_Z + 0.1 }]) {
      const placed = placeCreationInRoom(spot);
      expect(placed.anchor).toBe(placeSessionInRoom(spot).anchor);
      expect(placed.position).toEqual(placeSessionInRoom(spot).position);
      expect(placed.rotation).toEqual([0, 0, 0]);
    }
  });
});

describe('fitModelToRoom', () => {
  // A Z-up column 2 units tall on a 1×1 base, off to one side of the origin.
  const column = [
    { vertices: [[10, 10, 0], [11, 10, 0], [11, 11, 2]] as [number, number, number][] },
    { vertices: [[10, 11, 0], [11, 11, 2], [10, 10, 2]] as [number, number, number][] },
  ];

  it('stands a Z-up model upright, rests it on y = 0 and scales its largest side to the model size', () => {
    const fitted = fitModelToRoom(column);
    const ys = Array.from(fitted).filter((_, index) => index % 3 === 1);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(ROOM_MODEL_SIZE);
  });

  it('centres the model over its stand', () => {
    const fitted = Array.from(fitModelToRoom(column));
    const xs = fitted.filter((_, index) => index % 3 === 0);
    const zs = fitted.filter((_, index) => index % 3 === 2);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0);
    expect(Math.min(...zs) + Math.max(...zs)).toBeCloseTo(0);
  });

  it('fans a polygon into triangles and drops a corner that is not a number', () => {
    const quad = [{ vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] as [number, number, number][] }];
    expect(fitModelToRoom(quad)).toHaveLength(2 * 3 * 3);
    const broken = [{ vertices: [[0, 0, 0], [Number.NaN, 0, 0], [1, 1, 0]] as [number, number, number][] }];
    expect(fitModelToRoom(broken)).toHaveLength(0);
  });

  it('returns nothing for an empty mesh, so the stand shows the picture instead', () => {
    expect(fitModelToRoom([])).toHaveLength(0);
  });
});

describe('room spot storage for creations', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('keeps each creation apart from the session and from each other', () => {
    expect(roomSpotKey('s1', 'a')).not.toBe(roomSpotKey('s1'));
    writeRoomSpot(roomSpotKey('s1', 'a'), { x: 4, z: -3 });
    expect(readRoomSpot(roomSpotKey('s1', 'a'), { x: 0, z: 0 })).toEqual({ x: 4, z: -3 });
    expect(readRoomSpot(roomSpotKey('s1', 'b'), { x: 1, z: 1 })).toEqual({ x: 1, z: 1 });
    expect(readRoomSpot(roomSpotKey('s1'), { x: 0, z: 0 })).toEqual({ x: 0, z: 0 });
  });
});
