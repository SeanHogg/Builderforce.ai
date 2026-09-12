import { describe, it, expect } from 'vitest';
import {
  ROOM_LAYOUT_PRESETS,
  STANDUP_ROOM,
  addRoomFurniture,
  canvasRoomDesignFrom,
  defaultCanvasRoomDesign,
  moveRoomFurniture,
  removeRoomFurniture,
  restSurfaceAt,
  roomDesignGeometry,
  roomDesignOf,
  roomDesignSeats,
  roomDesignSpawn,
  roomDesignSummary,
  roomLayoutDesign,
  updateRoomFloor,
  updateRoomFurniture,
  type CanvasRoomDesign,
} from '@builderforce/creation-canvas-contract';

/**
 * The room design contract (`packages/creation-canvas-contract/src/roomDesign.ts`).
 *
 * Tested here because the contract package has no runner of its own; the frontend
 * is its heaviest reader and the API's Stage harness (`space`) reads the same
 * functions, so a regression shows up in both places at once.
 */

const empty = (): CanvasRoomDesign => ({ ...defaultCanvasRoomDesign(), furniture: [] });

describe('room layout presets', () => {
  it('builds a fresh design every call, never a shared array', () => {
    for (const preset of ROOM_LAYOUT_PRESETS) {
      const a = preset.build();
      const b = preset.build();
      expect(a).toEqual(b);
      expect(a.furniture).not.toBe(b.furniture);
      expect(a.layout).toBe(preset.id);
    }
  });

  it('survives its own defensive read unchanged', () => {
    for (const preset of ROOM_LAYOUT_PRESETS) {
      const design = preset.build();
      expect(canvasRoomDesignFrom(design)).toEqual(design);
    }
  });

  it('seats the people each layout is for', () => {
    expect(roomDesignSummary(roomLayoutDesign('standup')).seats).toBe(0);
    expect(roomDesignSummary(roomLayoutDesign('boardroom')).seats).toBe(10);
    // Six stools round the island, two on the sofa.
    expect(roomDesignSummary(roomLayoutDesign('kitchen')).seats).toBe(8);
    expect(roomDesignSummary(roomLayoutDesign('openPlan')).seats).toBe(9);
  });

  it('keeps every piece inside the walls', () => {
    for (const preset of ROOM_LAYOUT_PRESETS) {
      const design = preset.build();
      for (const item of design.furniture) {
        expect(Math.abs(item.position[0])).toBeLessThanOrEqual(design.floor.width / 2);
        expect(Math.abs(item.position[2])).toBeLessThanOrEqual(design.floor.depth / 2);
      }
    }
  });

  it('reads a room with neither field as the standup room', () => {
    expect(roomDesignOf({}).layout).toBe('standup');
    expect(roomDesignOf({ roomLayout: 'kitchen' }).layout).toBe('kitchen');
    expect(defaultCanvasRoomDesign().floor.width).toBe(STANDUP_ROOM.floorWidth);
  });
});

describe('furniture mutations', () => {
  it('hangs a wall piece dropped on the floor at wall height, and marks the room custom', () => {
    const { design, furniture } = addRoomFurniture(roomLayoutDesign('boardroom'), { kind: 'screen' });
    expect(furniture.position[1]).toBe(1.4);
    expect(design.layout).toBe('custom');
  });

  it('gives two pieces of one kind two ids', () => {
    const first = addRoomFurniture(empty(), { kind: 'chair' });
    const second = addRoomFurniture(first.design, { kind: 'chair' });
    expect(second.furniture.id).not.toBe(first.furniture.id);
  });

  it('keeps an https picture and refuses a script URL', () => {
    const kept = addRoomFurniture(empty(), { kind: 'poster', imageUrl: 'https://example.com/a.png' });
    expect(kept.furniture.imageUrl).toBe('https://example.com/a.png');
    const refused = addRoomFurniture(empty(), { kind: 'poster', imageUrl: 'javascript:alert(1)' });
    expect('imageUrl' in refused.furniture).toBe(false);
    // A chair cannot carry a picture at all.
    const chair = addRoomFurniture(empty(), { kind: 'chair', imageUrl: 'https://example.com/a.png' });
    expect('imageUrl' in chair.furniture).toBe(false);
  });

  it('drops the colour key when a colour is cleared, rather than storing undefined', () => {
    const { design, furniture } = addRoomFurniture(empty(), { kind: 'sofa', color: '#aa3300' });
    const cleared = updateRoomFurniture(design, furniture.id, { color: undefined });
    expect('color' in cleared.furniture[0]!).toBe(false);
    const floor = updateRoomFloor(updateRoomFloor(design, { color: '#112233' }), { color: undefined });
    expect('color' in floor.floor).toBe(false);
  });

  it('clamps a floor piece inside the walls', () => {
    const { design, furniture } = addRoomFurniture(empty(), { kind: 'chair' });
    const moved = moveRoomFurniture(design, furniture.id, 500, -500).furniture[0]!;
    const hw = design.floor.width / 2;
    const hd = design.floor.depth / 2;
    expect(moved.position[0]).toBeLessThanOrEqual(hw);
    expect(moved.position[0]).toBeGreaterThan(hw - 1);
    expect(moved.position[2]).toBeGreaterThanOrEqual(-hd);
  });

  it('slides a wall piece onto the nearest wall, facing into the room', () => {
    const { design, furniture } = addRoomFurniture(empty(), { kind: 'screen' });
    const hw = design.floor.width / 2;
    const moved = moveRoomFurniture(design, furniture.id, hw - 0.3, 0).furniture[0]!;
    expect(moved.position[0]).toBeCloseTo(hw - 0.08);
    expect(moved.yaw).toBeCloseTo(-Math.PI / 2);
    expect(moved.position[1]).toBe(1.4);
  });

  it('leaves the design untouched for an unknown piece or a non-finite drop', () => {
    const design = roomLayoutDesign('kitchen');
    expect(removeRoomFurniture(design, 'nope')).toBe(design);
    expect(moveRoomFurniture(design, 'stool-1', Number.NaN, 0)).toBe(design);
  });
});

describe('derived readings', () => {
  it('puts a chair seat in front of the chair, turned with it', () => {
    const facing = addRoomFurniture(empty(), { kind: 'chair', position: [1, 0, 2] }).design;
    const [seat] = roomDesignSeats(facing);
    expect(seat!.position[0]).toBeCloseTo(1);
    expect(seat!.position[2]).toBeCloseTo(2.45);

    const turned = addRoomFurniture(empty(), { kind: 'chair', position: [1, 0, 2], yaw: Math.PI }).design;
    const [back] = roomDesignSeats(turned);
    expect(back!.position[0]).toBeCloseTo(1);
    expect(back!.position[2]).toBeCloseTo(1.55);
    expect(back!.yaw).toBeCloseTo(Math.PI);
  });

  it('finds the standup table under its centre and nothing on bare floor', () => {
    const geometry = roomDesignGeometry(defaultCanvasRoomDesign());
    expect(restSurfaceAt(geometry, 0, 0)?.height).toBeCloseTo(STANDUP_ROOM.tableHeight);
    expect(restSurfaceAt(geometry, 5, 0)).toBeNull();
    expect(geometry.wallZ).toBeCloseTo(-STANDUP_ROOM.floorDepth / 2);
  });

  it('spawns a walker at the front of the floor, never behind the ring', () => {
    expect(roomDesignSpawn({ width: 14, depth: 10.4 }).position[2]).toBeCloseTo(3.8);
    expect(roomDesignSpawn({ width: 6, depth: 6 }).position[2]).toBeCloseTo(1.6);
  });
});

describe('canvasRoomDesignFrom', () => {
  it('reads not-a-design as the standup room', () => {
    expect(canvasRoomDesignFrom(null).layout).toBe('standup');
    expect(canvasRoomDesignFrom([1, 2]).layout).toBe('standup');
  });

  it('clamps the floor and walls to a room a person could stand in', () => {
    const read = canvasRoomDesignFrom({ floor: { width: 1000, depth: 1 }, wall: { height: -3 }, furniture: [] });
    expect(read.floor.width).toBe(60);
    expect(read.floor.depth).toBe(6);
    expect(read.wall.height).toBe(2.4);
  });

  it('drops unknown kinds, models whose file is gone, and unsafe model URLs', () => {
    const read = canvasRoomDesignFrom({
      layout: 'mansion',
      floor: { width: 10, depth: 10, color: 'red' },
      furniture: [
        { kind: 'throne', position: [0, 0, 0] },
        { kind: 'model', position: [0, 0, 0] },
        { kind: 'model', model: { url: 'data:model/stl;base64,AAAA', format: 'stl' } },
        { kind: 'model', model: { url: 'https://cdn.example.com/desk.glb', format: 'glb' } },
        { kind: 'chair', position: [99, 0, 0] },
      ],
    });
    expect(read.layout).toBe('custom');
    expect('color' in read.floor).toBe(false);
    expect(read.furniture.map((item) => item.kind)).toEqual(['model', 'chair']);
    expect(read.furniture[0]!.model).toEqual({ url: 'https://cdn.example.com/desk.glb', format: 'glb' });
    expect(read.furniture[1]!.position[0]).toBe(5);
  });

  it('caps a furniture list that is a payload rather than a room', () => {
    const furniture = Array.from({ length: 1000 }, () => ({ kind: 'plant' }));
    expect(canvasRoomDesignFrom({ furniture }).furniture).toHaveLength(400);
  });
});
