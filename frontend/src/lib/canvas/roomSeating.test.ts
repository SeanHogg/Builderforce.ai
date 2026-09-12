import { describe, it, expect } from 'vitest';
import type { CanvasPresenceSpatial } from '@builderforce/creation-canvas-contract';
import {
  ROOM_SEAT_RADIUS,
  assignRoomSeats, seatPlacement,
  type RoomOccupant,
} from './roomSeating';

/**
 * The room's geometry is arithmetic, which is the whole reason it lives outside
 * the renderer: these are the assertions that would otherwise be made by
 * squinting at a WebGL canvas and hoping.
 */

const occupants = (...ids: string[]): RoomOccupant[] =>
  ids.map((id) => ({ userId: id, displayName: id.toUpperCase() }));

const bodies = (entries: Record<string, CanvasPresenceSpatial>) =>
  new Map(Object.entries(entries));

describe('seatPlacement', () => {
  it('puts the first seat nearest the camera, on +Z', () => {
    const first = seatPlacement(0, 4);
    expect(first.position[0]).toBeCloseTo(0);
    expect(first.position[2]).toBeCloseTo(ROOM_SEAT_RADIUS);
    expect(first.yaw).toBeCloseTo(0);
  });

  it('spaces places evenly and keeps every one of them on the ring', () => {
    const count = 7;
    for (let i = 0; i < count; i += 1) {
      const { position } = seatPlacement(i, count);
      const radius = Math.hypot(position[0], position[2]);
      expect(radius).toBeCloseTo(ROOM_SEAT_RADIUS);
      expect(position[1]).toBe(0);
    }
  });

  /**
   * Facing is derived from the angle, and the test states the property rather
   * than the formula: a body on the ring looks at the middle of the table. A
   * yaw that drifted would put somebody's back to the standup.
   */
  it('aims every body at the centre of the table', () => {
    for (const [index, count] of [[0, 3], [1, 3], [2, 3], [3, 8]] as const) {
      const { position, yaw } = seatPlacement(index, count);
      // three.js yaw 0 faces -Z, so a body's forward vector is (-sin, -cos).
      const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      const toCentre = { x: -position[0], z: -position[2] };
      const length = Math.hypot(toCentre.x, toCentre.z);
      expect(forward.x).toBeCloseTo(toCentre.x / length);
      expect(forward.z).toBeCloseTo(toCentre.z / length);
    }
  });

  it('does not divide by zero for an empty room', () => {
    expect(seatPlacement(0, 0).position.every(Number.isFinite)).toBe(true);
  });
});

describe('assignRoomSeats', () => {
  it('seats the whole roster, not only the people the relay has heard from', () => {
    const seats = assignRoomSeats(occupants('a', 'b', 'c'), bodies({}), 'a');
    expect(seats.map((seat) => seat.userId)).toEqual(['a', 'b', 'c']);
    expect(seats.every((seat) => seat.live)).toBe(false);
  });

  it('marks the viewer, so a person can find themselves in the circle', () => {
    const seats = assignRoomSeats(occupants('a', 'b'), bodies({}), 'b');
    expect(seats.map((seat) => seat.isSelf)).toEqual([false, true]);
  });

  it('lets a relayed body override the chair the roster assumed', () => {
    const walked: CanvasPresenceSpatial = { position: [4, 0, -1], yaw: 2 };
    const seats = assignRoomSeats(occupants('a', 'b'), bodies({ b: walked }), 'a');
    expect(seats[1]).toMatchObject({ position: [4, 0, -1], yaw: 2, live: true });
    // …and the person nobody has heard from stays exactly where the ring put them.
    expect(seats[0]!.position).toEqual(seatPlacement(0, 2).position);
    expect(seats[0]!.live).toBe(false);
  });

  it('honours a peer who says they moved to a different chair', () => {
    const claimed: CanvasPresenceSpatial = { position: [0, 0, 0], yaw: 0, seat: 2 };
    const seats = assignRoomSeats(occupants('a', 'b', 'c'), bodies({ a: claimed }), 'z');
    expect(seats[0]!.index).toBe(2);
  });

  /**
   * The order is the roster's, and that matters more than it looks: sorting by
   * name would move every body whenever anybody was renamed, and the room would
   * appear to shuffle itself mid-standup.
   */
  it('keeps roster order rather than inventing one', () => {
    const seats = assignRoomSeats(occupants('zoe', 'adam'), bodies({}), null);
    expect(seats.map((seat) => seat.userId)).toEqual(['zoe', 'adam']);
  });

  it('leaves an unnamed peer unnamed rather than guessing a label', () => {
    const seats = assignRoomSeats([{ userId: 'u1' }], bodies({}), null);
    expect(seats[0]!.displayName).toBe('');
  });

  /**
   * "0 of 1 here" with only you in the room was the bug: the viewer is reading the
   * room, so is in it, and an agent's card on the board is its presence.
   */
  it('counts the viewer and the agents on the board as here', () => {
    const seats = assignRoomSeats(
      [{ userId: 'me' }, { userId: 'peer' }, { userId: 'agent:cmo', displayName: 'CMO', kind: 'agent' }],
      bodies({}),
      'me',
    );
    expect(seats.map((seat) => [seat.kind, seat.present])).toEqual([
      ['human', true], ['human', false], ['agent', true],
    ]);
  });
});
