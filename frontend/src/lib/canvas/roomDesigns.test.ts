import { describe, it, expect } from 'vitest';
import { activeRoomDesign, roomDesignObjectsOf } from './roomDesigns';

/** Which room a session meets in, when its board holds several — or none. */

const object = (id: string, data: Record<string, unknown>) => ({ id, data });

describe('roomDesignObjectsOf', () => {
  it('reads only room objects, in board order', () => {
    const rooms = roomDesignObjectsOf([
      object('a', { kind: 'game', title: 'Obby' }),
      object('b', { kind: 'room', title: '  Kitchen  ', roomLayout: 'kitchen' }),
      object('c', { kind: 'room', title: 'Boardroom', roomLayout: 'boardroom' }),
    ]);
    expect(rooms.map((room) => room.id)).toEqual(['b', 'c']);
    expect(rooms[0]!.title).toBe('Kitchen');
  });

  it('reads a layout-only room as its preset, with its seats counted', () => {
    const [room] = roomDesignObjectsOf([object('b', { kind: 'room', roomLayout: 'boardroom' })]);
    expect(room!.layout).toBe('boardroom');
    expect(room!.seats).toBe(10);
    expect(room!.pieces).toBeGreaterThan(10);
  });

  it('ignores an activatedAt that is not a date', () => {
    const [room] = roomDesignObjectsOf([object('b', { kind: 'room', activatedAt: 'yesterday' })]);
    expect(room!.activatedAt).toBeNull();
  });
});

describe('activeRoomDesign', () => {
  it('is null on a board with no rooms — the standup room', () => {
    expect(activeRoomDesign([])).toBeNull();
  });

  it('falls back to the first room when none was ever chosen', () => {
    const rooms = roomDesignObjectsOf([object('a', { kind: 'room' }), object('b', { kind: 'room' })]);
    expect(activeRoomDesign(rooms)!.id).toBe('a');
  });

  it('takes the room chosen most recently, wherever it sits on the board', () => {
    const rooms = roomDesignObjectsOf([
      object('a', { kind: 'room', activatedAt: '2026-09-01T10:00:00.000Z' }),
      object('b', { kind: 'room' }),
      object('c', { kind: 'room', activatedAt: '2026-09-10T10:00:00.000Z' }),
      object('d', { kind: 'room', activatedAt: '2026-09-05T10:00:00.000Z' }),
    ]);
    expect(activeRoomDesign(rooms)!.id).toBe('c');
  });
});
