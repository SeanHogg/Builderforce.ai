import { describe, expect, it } from 'vitest';
import {
  ROOM_STATION_SIDE_X,
  defaultRoomStationSpot,
  placeStationInRoom,
  roomStationInstances,
} from './roomStations';

describe('roomStationInstances', () => {
  it('always stands the approval desk, a metrics board only once a metric exists, and one stand per widget placement', () => {
    expect(roomStationInstances([]).map((instance) => instance.key)).toEqual(['approvals']);
    const board = [
      { id: 'm', data: { kind: 'metric', title: 'MRR', definition: { name: 'MRR', aggregate: { op: 'count' } } } },
      { id: 'w1', data: { kind: 'note', title: 'Chart widget', resourceId: 'canvas_widget:0b4c7e0a-1111-4222-8333-444455556666' } },
      { id: 'n', data: { kind: 'note', title: 'Not a widget', resourceId: 'task:12' } },
    ];
    const instances = roomStationInstances(board);
    expect(instances.map((instance) => instance.key)).toEqual(['approvals', 'metrics', 'widget:w1']);
    expect(instances[2]).toMatchObject({ station: 'widget', objectId: 'w1', resourceId: '0b4c7e0a-1111-4222-8333-444455556666', title: 'Chart widget' });
  });
});

describe('station placement', () => {
  it('alternates the side walls, front to back', () => {
    expect(defaultRoomStationSpot(0).x).toBe(-ROOM_STATION_SIDE_X);
    expect(defaultRoomStationSpot(1).x).toBe(ROOM_STATION_SIDE_X);
    expect(defaultRoomStationSpot(2).z).toBeGreaterThan(defaultRoomStationSpot(0).z);
  });

  it('stands on the floor and turns to face the table', () => {
    const placed = placeStationInRoom(defaultRoomStationSpot(0));
    expect(placed.anchor).toBe('floor');
    const [x, , z] = placed.position;
    const yaw = placed.rotation[1];
    // The face (+Z in local space) points back toward the room's centre.
    const facing = [Math.sin(yaw), Math.cos(yaw)];
    expect(facing[0]! * -x + facing[1]! * -z).toBeGreaterThan(0);
  });
});
