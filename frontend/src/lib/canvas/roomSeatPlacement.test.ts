import { describe, it, expect } from 'vitest';
import type { RoomSeatSpot } from '@builderforce/creation-canvas-contract';
import { ROOM_STANDING_RADIUS, roomSeatPlacement, seatPlacement } from './roomSeating';

/**
 * Where the Nth person goes in a DESIGNED room: in its chairs while there are
 * chairs, then standing in a wider ring round them — never inside the furniture.
 */

const seats: RoomSeatSpot[] = [
  { position: [-1, 0, 1.25], yaw: 0 },
  { position: [1, 0, -1.25], yaw: Math.PI },
];

describe('roomSeatPlacement', () => {
  it('is the standup ring when the room seats nobody', () => {
    expect(roomSeatPlacement(2, 5, [])).toEqual(seatPlacement(2, 5));
  });

  it('puts the first people in the designed chairs, facing the way the chair faces', () => {
    expect(roomSeatPlacement(0, 4, seats)).toEqual({ position: seats[0]!.position, yaw: 0 });
    expect(roomSeatPlacement(1, 4, seats)).toEqual({ position: seats[1]!.position, yaw: Math.PI });
  });

  it('stands everyone past the last chair on the wider ring', () => {
    const first = roomSeatPlacement(2, 3, seats);
    expect(Math.hypot(first.position[0], first.position[2])).toBeCloseTo(ROOM_STANDING_RADIUS);
    const again = roomSeatPlacement(3, 4, seats);
    expect(Math.hypot(again.position[0], again.position[2])).toBeCloseTo(ROOM_STANDING_RADIUS);
    expect(again.position).not.toEqual(first.position);
  });
});
