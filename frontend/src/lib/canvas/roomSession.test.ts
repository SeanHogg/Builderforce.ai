import { describe, it, expect, beforeEach } from 'vitest';
import type { Canvas3DScene } from '@/components/canvas/canvas3d';
import { CANVAS_3D_LAYER_GAP } from '@/components/canvas/canvas3d';
import { ROOM_FLOOR_SIZE, ROOM_TABLE_HEIGHT, ROOM_TABLE_RADIUS, ROOM_WALL_Z } from './roomSeating';
import {
  DEFAULT_ROOM_SESSION_SPOT, ROOM_SESSION_FOOTPRINT, ROOM_SESSION_LAYER_STEP,
  ROOM_SESSION_PREVIEW_CAPACITY, ROOM_SESSION_WALL_HEIGHT,
  placeSessionInRoom, readRoomSessionSpot, roomSessionDiorama, writeRoomSessionSpot,
} from './roomSession';

/**
 * Where the session sits in the room, and what it looks like there, are
 * arithmetic — which is the reason they live outside the renderer and can be
 * pinned here instead of by squinting at a WebGL canvas.
 */

describe('placeSessionInRoom', () => {
  it('rests on the table when the spot is within the table', () => {
    const placed = placeSessionInRoom({ x: 0.4, z: -0.3 });
    expect(placed.anchor).toBe('table');
    expect(placed.position[1]).toBeGreaterThan(ROOM_TABLE_HEIGHT);
    // Lying flat: the sheet is rotated down onto the top.
    expect(placed.rotation[0]).toBeCloseTo(-Math.PI / 2);
  });

  it('hangs on the wall when the spot is against it, at eye level and upright', () => {
    const placed = placeSessionInRoom({ x: 1, z: ROOM_WALL_Z + 0.2 });
    expect(placed.anchor).toBe('wall');
    expect(placed.position[2]).toBe(ROOM_WALL_Z);
    expect(placed.position[1]).toBe(ROOM_SESSION_WALL_HEIGHT);
    expect(placed.rotation).toEqual([0, 0, 0]);
  });

  it('otherwise sits on the floor, just above it', () => {
    const placed = placeSessionInRoom({ x: 3, z: 3 });
    expect(placed.anchor).toBe('floor');
    expect(placed.position[1]).toBeGreaterThan(0);
    expect(placed.position[1]).toBeLessThan(ROOM_TABLE_HEIGHT);
  });

  it('climbs onto the table as a drag crosses its edge, and steps off again', () => {
    expect(placeSessionInRoom({ x: ROOM_TABLE_RADIUS - 0.01, z: 0 }).anchor).toBe('table');
    expect(placeSessionInRoom({ x: ROOM_TABLE_RADIUS + 0.01, z: 0 }).anchor).toBe('floor');
  });

  it('never leaves the room, whatever the pointer said', () => {
    const half = ROOM_FLOOR_SIZE / 2;
    const far = placeSessionInRoom({ x: 500, z: 500 });
    expect(Math.abs(far.position[0])).toBeLessThan(half);
    expect(far.position[2]).toBeLessThan(half);
    // Behind the wall is the wall.
    expect(placeSessionInRoom({ x: 0, z: -500 }).anchor).toBe('wall');
    // Garbage is the default, not a crash.
    expect(placeSessionInRoom({ x: Number.NaN, z: Number.NaN }).anchor).toBe('table');
  });

  it('starts a session on the table', () => {
    expect(placeSessionInRoom(DEFAULT_ROOM_SESSION_SPOT).anchor).toBe('table');
  });
});

describe('roomSessionDiorama', () => {
  const card = (id: string, extra: Partial<Canvas3DScene['cards'][number]> = {}): Canvas3DScene['cards'][number] => ({
    id, label: id, group: 'g', width: 200, height: 100, layer: 0, layerZ: 0, locked: false, x: 0, y: 0, z: 0, ...extra,
  });
  const scene = (cards: Canvas3DScene['cards'], layers = 1): Canvas3DScene => ({
    cards,
    links: [],
    layers: Array.from({ length: layers }, (_, index) => ({ index, z: index * CANVAS_3D_LAYER_GAP, count: 1 })),
    plane: { width: 800, height: 400 },
    depthMode: 'flow',
  });

  it('fits the longest edge of the board into the footprint', () => {
    const diorama = roomSessionDiorama(scene([card('a')]));
    expect(diorama.width).toBeCloseTo(ROOM_SESSION_FOOTPRINT);
    expect(diorama.height).toBeCloseTo(ROOM_SESSION_FOOTPRINT / 2);
    expect(diorama.cards[0]!.width).toBeCloseTo(200 * diorama.scale);
  });

  it('flips the board’s downward y into the sheet’s upward y', () => {
    const diorama = roomSessionDiorama(scene([card('low', { y: 100 })]));
    expect(diorama.cards[0]!.position[1]).toBeLessThan(0);
  });

  it('stacks layers by a fixed step rather than the projection’s pixel gap', () => {
    const diorama = roomSessionDiorama(scene([
      card('base'),
      card('above', { layer: 1, layerZ: CANVAS_3D_LAYER_GAP, z: CANVAS_3D_LAYER_GAP }),
    ], 2));
    expect(diorama.cards[1]!.position[2]).toBeCloseTo(ROOM_SESSION_LAYER_STEP);
    expect(diorama.plates.map((plate) => plate.z)).toEqual([0, ROOM_SESSION_LAYER_STEP]);
    expect(diorama.depth).toBeCloseTo(ROOM_SESSION_LAYER_STEP);
  });

  it('keeps an object floated off its layer floated, in proportion', () => {
    const diorama = roomSessionDiorama(scene([card('lifted', { z: CANVAS_3D_LAYER_GAP / 2 })]));
    expect(diorama.cards[0]!.position[2]).toBeCloseTo(ROOM_SESSION_LAYER_STEP / 2);
  });

  it('caps the pictures, not the cards', () => {
    const many = Array.from({ length: ROOM_SESSION_PREVIEW_CAPACITY + 10 }, (_, i) => card(`c${i}`, { preview: 'https://x/y.png' }));
    const diorama = roomSessionDiorama(scene(many));
    expect(diorama.cards).toHaveLength(many.length);
    expect(diorama.cards.filter((entry) => entry.preview)).toHaveLength(ROOM_SESSION_PREVIEW_CAPACITY);
  });

  it('draws nothing for an empty board rather than a plate with nothing on it', () => {
    const diorama = roomSessionDiorama({ cards: [], links: [], layers: [], plane: { width: 0, height: 0 }, depthMode: 'flow' });
    expect(diorama.cards).toEqual([]);
    expect(diorama.plates).toEqual([]);
  });
});

describe('room session spot storage', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('remembers the spot per session and per browser, and derives nothing else', () => {
    writeRoomSessionSpot('s1', { x: 2, z: 3 });
    expect(readRoomSessionSpot('s1')).toEqual({ x: 2, z: 3 });
    expect(readRoomSessionSpot('s2')).toEqual(DEFAULT_ROOM_SESSION_SPOT);
  });

  it('falls back to the table on a corrupt value rather than throwing', () => {
    window.localStorage.setItem('builderforce:create:room-session:s1', '{"x":"no"}');
    expect(readRoomSessionSpot('s1')).toEqual(DEFAULT_ROOM_SESSION_SPOT);
    window.localStorage.setItem('builderforce:create:room-session:s1', 'not json');
    expect(readRoomSessionSpot('s1')).toEqual(DEFAULT_ROOM_SESSION_SPOT);
  });
});
