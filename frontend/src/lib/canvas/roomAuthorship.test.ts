import { describe, expect, it } from 'vitest';
import {
  MAX_FLOOR,
  MAX_FURNITURE,
  MIN_FLOOR,
  ROOM_FURNITURE_KINDS,
  ROOM_LAYOUT_IDS,
  canvasRoomDesignFrom,
} from '@builderforce/creation-canvas-contract';
import { emptyShellProblem } from '@/components/creation-canvas/creationObjectRegistry';
import {
  THEATER_SEAT_MAX,
  THEATER_SEAT_MIN,
  buildTheaterRoomDesign,
  emptyRoomDesignProblem,
  roomAuthorshipProblem,
} from './roomAuthorship';

describe('roomAuthorshipProblem / emptyShellProblem(room)', () => {
  it('refuses content-only and title-only rooms as empty shells', () => {
    const contentOnly = roomAuthorshipProblem({ title: 'Theater', content: 'A grand auditorium with doors and lights.' });
    expect(contentOnly).toContain('empty shell');
    expect(contentOnly).toContain('roomLayout');
    expect(emptyShellProblem('room', { title: 'Theater', content: 'A grand auditorium' })).toContain('empty shell');
  });

  it('accepts a valid preset layout without a custom design', () => {
    for (const layout of ROOM_LAYOUT_IDS) {
      expect(roomAuthorshipProblem({ roomLayout: layout })).toBeNull();
      expect(emptyShellProblem('room', { roomLayout: layout })).toBeNull();
    }
  });

  it('refuses a roomDesign that sanitizes to zero furniture and lists valid kinds', () => {
    const problem = emptyRoomDesignProblem({
      floor: { width: 20, depth: 20 },
      wall: { height: 4 },
      furniture: [
        { kind: 'door', position: [0, 0, 0] },
        { kind: 'podium', position: [1, 0, 0] },
        { kind: 'light', position: [2, 0, 0] },
      ],
    });
    expect(problem).toContain('zero furniture');
    expect(problem).toContain(ROOM_FURNITURE_KINDS[0]);
    expect(problem).toContain('screen');
    expect(problem).toContain('chair');
    expect(roomAuthorshipProblem({
      roomLayout: 'boardroom',
      roomDesign: { furniture: [{ kind: 'door' }] },
    })).toContain('zero furniture');
  });

  it('accepts a roomDesign that keeps at least one valid piece', () => {
    expect(roomAuthorshipProblem({
      roomDesign: {
        floor: { width: 12, depth: 10 },
        wall: { height: 4 },
        furniture: [{ kind: 'chair', position: [0, 0, 1], yaw: 0, scale: [1, 1, 1] }],
      },
    })).toBeNull();
  });
});

describe('buildTheaterRoomDesign', () => {
  it('builds theater seating with only valid kinds, clamped seats and floor', () => {
    const design = buildTheaterRoomDesign(24);
    expect(design.layout).toBe('custom');
    expect(design.furniture.length).toBeGreaterThan(0);
    expect(design.furniture.length).toBeLessThanOrEqual(MAX_FURNITURE);
    expect(design.furniture.every((item) => (ROOM_FURNITURE_KINDS as readonly string[]).includes(item.kind))).toBe(true);
    expect(design.furniture.some((item) => item.kind === 'screen')).toBe(true);
    expect(design.furniture.filter((item) => item.kind === 'chair')).toHaveLength(24);
    expect(design.floor.width).toBeGreaterThanOrEqual(MIN_FLOOR);
    expect(design.floor.width).toBeLessThanOrEqual(MAX_FLOOR);
    expect(design.floor.depth).toBeGreaterThanOrEqual(MIN_FLOOR);
    expect(design.floor.depth).toBeLessThanOrEqual(MAX_FLOOR);
    // Round-trip through the sanitiser must not empty it.
    expect(canvasRoomDesignFrom(design).furniture.length).toBe(design.furniture.length);
  });

  it('clamps seat counts to the theater range', () => {
    expect(buildTheaterRoomDesign(1).furniture.filter((item) => item.kind === 'chair')).toHaveLength(THEATER_SEAT_MIN);
    expect(buildTheaterRoomDesign(10_000).furniture.filter((item) => item.kind === 'chair')).toHaveLength(THEATER_SEAT_MAX);
    expect(buildTheaterRoomDesign(Number.NaN).furniture.filter((item) => item.kind === 'chair')).toHaveLength(THEATER_SEAT_MIN);
  });
});
