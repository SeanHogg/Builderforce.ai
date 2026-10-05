import { describe, expect, it } from 'vitest';
import { readinessByPhase, readinessSignals } from '../canvasPhaseReadiness';
import type { CanvasPhase } from '../canvasPhases';
import {
  LAUNCH_STATION_KINDS,
  ROOM_STATION_SIDE_X,
  ROOM_STATION_SPECS,
  defaultRoomStationSpot,
  litStationsFirst,
  placeStationInRoom,
  roomStationInstances,
  type RoomStationObject,
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

describe('the Evermind brain station', () => {
  it('stands one brain per Evermind object, carrying the project it learns for once attached', () => {
    const instances = roomStationInstances([
      { id: 'e1', data: { kind: 'evermind', title: 'Training Setup', resourceId: 'evermind:42' } },
      { id: 'e2', data: { kind: 'evermind', title: 'Blueprint' } },
      { id: 'x', data: { kind: 'note', title: 'Not a brain', resourceId: 'evermind:7' } },
    ]).filter((instance) => instance.station === 'evermind');
    expect(instances).toEqual([
      { key: 'evermind:e1', station: 'evermind', objectId: 'e1', title: 'Training Setup', resourceId: '42' },
      { key: 'evermind:e2', station: 'evermind', objectId: 'e2', title: 'Blueprint' },
    ]);
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

// ── PRD 32 W9: THE ARC'S STATIONS ────────────────────────────────────────────────────

const idea = { id: 'i1', data: { kind: 'idea', title: 'Yard care on demand', stage: 'exploring' } };
const app = { id: 'a1', data: { kind: 'build', title: 'Yard app', localAppKey: 'room-stations-test-app' } };
const plannedDeploy = { id: 'd1', data: { kind: 'deployment', title: 'Prod', environmentName: 'production' } };
const liveDeploy = { id: 'd2', data: { kind: 'deployment', title: 'Prod', environmentName: 'production', url: 'https://yard.example.com' } };
const metric = { id: 'm', data: { kind: 'metric', title: 'MRR', definition: { name: 'MRR', aggregate: { op: 'count' } } } };

function contextFor(objects: readonly RoomStationObject[], phase: CanvasPhase) {
  return { phase, readiness: readinessByPhase(readinessSignals(objects as RoomStationObject[])) };
}

function keysOf(objects: readonly RoomStationObject[], phase?: CanvasPhase): string[] {
  return roomStationInstances(objects, undefined, phase ? contextFor(objects, phase) : undefined).map((instance) => instance.key);
}

describe('the arc stations — when each stands', () => {
  it('stands the evidence station only once the board holds an idea', () => {
    expect(keysOf([])).not.toContain('evidence');
    expect(keysOf([{ id: 'n', data: { kind: 'note', title: 'Not an idea' } }])).not.toContain('evidence');
    expect(keysOf([idea])).toContain('evidence');
  });

  it('stands the build station only once the board has an app', () => {
    expect(keysOf([])).not.toContain('build');
    // A Builder card with no workspace behind it (no project, no local key) is not an app.
    expect(keysOf([{ id: 'b0', data: { kind: 'build', title: 'Empty builder' } }])).not.toContain('build');
    expect(keysOf([app])).toContain('build');
  });

  it('stands the ops station for any deployment card, live or planned', () => {
    expect(keysOf([])).not.toContain('ops');
    expect(keysOf([plannedDeploy])).toContain('ops');
    expect(keysOf([liveDeploy])).toContain('ops');
  });

  it('stands the launch station for each launch kind, and for nothing else', () => {
    expect(keysOf([])).not.toContain('launch');
    for (const kind of LAUNCH_STATION_KINDS) {
      expect(keysOf([{ id: `x-${kind}`, data: { kind, title: kind } }])).toContain('launch');
    }
    expect(keysOf([{ id: 'sc', data: { kind: 'socialCampaign', title: 'Not counted' } }])).not.toContain('launch');
    // Several launch objects still stand ONE launch station.
    expect(keysOf([
      { id: 'p1', data: { kind: 'socialPost', title: 'a' } },
      { id: 'p2', data: { kind: 'emailCampaign', title: 'b' } },
    ]).filter((key) => key === 'launch')).toHaveLength(1);
  });
});

describe('the path sign', () => {
  it('never stands without a phase context, or without readiness', () => {
    expect(keysOf([])).not.toContain('phasePath');
    expect(roomStationInstances([], undefined, { phase: 'measure' }).map((instance) => instance.key)).not.toContain('phasePath');
  });

  it("stands while the canvas's phase is not ready, and goes once it is", () => {
    // Make needs an idea.
    expect(keysOf([], 'make')).toContain('phasePath');
    expect(keysOf([idea], 'make')).not.toContain('phasePath');
    // Measure needs an idea, an app and a LIVE deployment — a planned one is not enough.
    expect(keysOf([idea, app, plannedDeploy], 'measure')).toContain('phasePath');
    expect(keysOf([idea, app, liveDeploy], 'measure')).not.toContain('phasePath');
    // Idea requires nothing, so it is always ready.
    expect(keysOf([], 'idea')).not.toContain('phasePath');
  });

  it("stands last, so its coming and going never shifts another station's spot", () => {
    const keys = keysOf([idea, metric], 'measure');
    expect(keys[keys.length - 1]).toBe('phasePath');
    expect(keys.slice(0, -1)).toEqual(keysOf([idea, metric]));
  });
});

describe('stations without a phase context', () => {
  it('stand exactly as they did before phases existed — same keys, no lit flag', () => {
    const board = [
      metric,
      { id: 'w1', data: { kind: 'note', title: 'Chart widget', resourceId: 'canvas_widget:0b4c7e0a-1111-4222-8333-444455556666' } },
      { id: 'e1', data: { kind: 'evermind', title: 'Brain', resourceId: 'evermind:42' } },
      { id: 'as', data: { kind: 'assignment', title: 'Essay' } },
      { id: 'c', data: { kind: 'citation', title: 'Ref' } },
    ];
    const instances = roomStationInstances(board);
    expect(instances.map((instance) => instance.key)).toEqual(['approvals', 'metrics', 'widget:w1', 'evermind:e1', 'assessment', 'citations']);
    expect(instances.every((instance) => !('lit' in instance))).toBe(true);
    expect(roomStationInstances(board, ROOM_STATION_SPECS, undefined)).toEqual(instances);
  });

  it('appends the arc specs after every pre-existing spec, so default spots are unchanged', () => {
    const ids = ROOM_STATION_SPECS.map((spec) => spec.id);
    expect(ids.slice(-5)).toEqual(['evidence', 'build', 'ops', 'launch', 'phasePath']);
    expect(ids.slice(0, -5)).toEqual(['approvals', 'metrics', 'widget', 'evermind', 'assessment', 'gradebook', 'accessibility', 'citations']);
    // A board that had a metric keeps its metrics board at the same index once an idea joins.
    const before = keysOf([metric]);
    const after = keysOf([metric, idea]);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(defaultRoomStationSpot(after.indexOf('metrics'))).toEqual(defaultRoomStationSpot(before.indexOf('metrics')));
  });

  it('gives each arc spec its phase, and metrics Measure', () => {
    const phaseOf = Object.fromEntries(ROOM_STATION_SPECS.map((spec) => [spec.id, spec.phase]));
    expect(phaseOf).toMatchObject({ evidence: 'idea', build: 'make', ops: 'run', metrics: 'measure', launch: 'reach' });
    expect(phaseOf.approvals).toBeUndefined();
    expect(phaseOf.phasePath).toBeUndefined();
  });
});

describe('the lit station', () => {
  const board = [idea, app, liveDeploy, metric, { id: 'sp', data: { kind: 'socialPost', title: 'Launch post' } }];
  const expected: Record<CanvasPhase, string> = { idea: 'evidence', make: 'build', run: 'ops', measure: 'metrics', reach: 'launch' };

  it('lights only the station whose phase the canvas is in', () => {
    for (const [phase, station] of Object.entries(expected) as [CanvasPhase, string][]) {
      const instances = roomStationInstances(board, undefined, contextFor(board, phase));
      expect(instances.filter((instance) => instance.lit).map((instance) => instance.key)).toEqual([station]);
    }
  });

  it("lights nothing when the phase's station is not standing", () => {
    const instances = roomStationInstances([idea], undefined, contextFor([idea], 'measure'));
    expect(instances.some((instance) => instance.lit)).toBe(false);
  });

  it('never reorders the room — lit is a flag, the order is registry order', () => {
    const plain = roomStationInstances(board).map((instance) => instance.key);
    const lit = roomStationInstances(board, undefined, contextFor(board, 'reach')).map((instance) => instance.key);
    expect(lit).toEqual(plain);
  });
});

describe('litStationsFirst', () => {
  it('puts the lit station first and keeps the rest in room order', () => {
    const sorted = litStationsFirst([
      { key: 'approvals', station: 'approvals' },
      { key: 'metrics', station: 'metrics' },
      { key: 'evidence', station: 'evidence', lit: true },
      { key: 'ops', station: 'ops' },
    ]);
    expect(sorted.map((instance) => instance.key)).toEqual(['evidence', 'approvals', 'metrics', 'ops']);
  });

  it('leaves an unlit list as it was, without mutating its input', () => {
    const input = [{ key: 'a', station: 'a' }, { key: 'b', station: 'b' }];
    const sorted = litStationsFirst(input);
    expect(sorted.map((instance) => instance.key)).toEqual(['a', 'b']);
    expect(sorted).not.toBe(input);
  });
});
