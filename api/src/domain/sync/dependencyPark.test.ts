import { describe, expect, it } from 'vitest';
import {
  DEPENDENCY_PARK_STATUS,
  DependencyParkError,
  park,
  resume,
  type DependencyLike,
  type LandedIds,
  type ParkedDependency,
} from './dependencyPark';

/** The fields the park actually reads, plus the ones a receipt would carry. */
interface TestEvent extends DependencyLike {
  eventId: string;
  dependsOn: string[];
}

function event(eventId: string, dependsOn: string[]): TestEvent {
  return { eventId, dependsOn };
}

const PARENT = 'project:project-1:v1';
const CHANGE_SET = 'change-set:run-7:v2';

describe('park', () => {
  it('stores an unmet dependency under dependency_pending', () => {
    const next = park([], event('e1', [PARENT]), []);

    expect(DEPENDENCY_PARK_STATUS).toBe('dependency_pending');
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({
      event: { eventId: 'e1', dependsOn: [PARENT] },
      dependsOn: PARENT,
      status: 'dependency_pending',
    });
    expect(next[0]?.status).toBe('dependency_pending');
  });

  it('does not park an event whose dependency already landed', () => {
    const pending: ParkedDependency<TestEvent>[] = [];

    const next = park(pending, event('e1', [PARENT]), [PARENT]);

    expect(next).toEqual([]);
    expect(pending).toEqual([]);
  });

  it('parks on the first id that has not landed when only some have', () => {
    const next = park([], event('e1', [PARENT, CHANGE_SET]), [PARENT]);

    expect(next).toHaveLength(1);
    expect(next[0]?.dependsOn).toBe(CHANGE_SET);
  });

  it('accepts a Set of landed ids as well as an array', () => {
    const landed: LandedIds = new Set([PARENT]);

    expect(park([], event('e1', [PARENT]), landed)).toEqual([]);
    expect(park([], event('e2', [CHANGE_SET]), landed)[0]?.dependsOn).toBe(CHANGE_SET);
  });

  it('throws not_a_dependency and appends nothing when dependsOn is missing or blank', () => {
    const empty: ParkedDependency<TestEvent>[] = [];

    for (const event of [
      { eventId: 'missing', dependsOn: undefined } as unknown as TestEvent,
      { eventId: 'null', dependsOn: null } as unknown as TestEvent,
      { eventId: 'blank', dependsOn: '' } as unknown as TestEvent,
      { eventId: 'blank-space', dependsOn: '   ' } as unknown as TestEvent,
      { eventId: 'empty', dependsOn: [] },
      { eventId: 'blanks', dependsOn: ['', '  '] },
    ]) {
      let thrown: unknown;
      try {
        park(empty, event, []);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(DependencyParkError);
      expect((thrown as DependencyParkError).code).toBe('not_a_dependency');
      expect((thrown as DependencyParkError).name).toBe('DependencyParkError');
    }

    expect(empty).toEqual([]);
  });

  it('appends to an existing park without mutating it, and returns a new list', () => {
    const pending: ParkedDependency<TestEvent>[] = [
      { event: event('e1', [PARENT]), dependsOn: PARENT, status: DEPENDENCY_PARK_STATUS },
    ];

    const next = park(pending, event('e2', [CHANGE_SET]), []);

    expect(pending).toHaveLength(1);
    expect(pending[0]?.event.eventId).toBe('e1');
    expect(next).toHaveLength(2);
    expect(next[0]).not.toBe(pending[0]);
    expect(next[0]).toEqual(pending[0]);
    expect(next[1]?.event.eventId).toBe('e2');
  });

  it('trims ids so a padded id is the same dependency as a trimmed one', () => {
    const next = park([], event('e1', [`  ${PARENT}  `]), [PARENT]);

    expect(next).toEqual([]);
  });
});

describe('resume', () => {
  const pending: ParkedDependency<TestEvent>[] = [
    { event: event('e1', [PARENT]), dependsOn: PARENT, status: DEPENDENCY_PARK_STATUS },
    { event: event('e2', [CHANGE_SET]), dependsOn: CHANGE_SET, status: DEPENDENCY_PARK_STATUS },
    { event: event('e3', [CHANGE_SET]), dependsOn: CHANGE_SET, status: DEPENDENCY_PARK_STATUS },
  ];

  it('releases every event waiting on the landed id and keeps the rest', () => {
    const { stillPending, ready } = resume(pending, CHANGE_SET);

    expect(ready.map((released) => released.eventId)).toEqual(['e2', 'e3']);
    expect(stillPending.map((entry) => entry.event.eventId)).toEqual(['e1']);
    expect(stillPending[0]).toEqual(pending[0]);
    expect(stillPending[0]).not.toBe(pending[0]);
  });

  it('leaves no released event in stillPending', () => {
    const { stillPending, ready } = resume(pending, CHANGE_SET);
    const parked = pending.map((entry) => entry.event.eventId);

    expect(ready.map((released) => released.eventId)).toEqual(['e2', 'e3']);
    expect(stillPending).toHaveLength(parked.length - ready.length);
    for (const released of ready) {
      expect(stillPending.map((entry) => entry.event.eventId)).not.toContain(released.eventId);
    }
  });

  it('moves nothing for an id nothing was waiting on', () => {
    const { stillPending, ready } = resume(pending, 'audit-run:run-9:v1');

    expect(ready).toEqual([]);
    expect(stillPending.map((entry) => entry.event.eventId)).toEqual(['e1', 'e2', 'e3']);
    expect(pending).toHaveLength(3);
  });

  it('moves nothing for a blank or unknown landed id', () => {
    for (const landedId of ['', '   ']) {
      const { stillPending, ready } = resume(pending, landedId);
      expect(ready).toEqual([]);
      expect(stillPending).toHaveLength(3);
    }
  });

  it('empties the park when the last dependency lands', () => {
    const first = resume(pending, CHANGE_SET);
    const second = resume(first.stillPending, PARENT);

    expect(second.ready.map((released) => released.eventId)).toEqual(['e1']);
    expect(second.stillPending).toEqual([]);
  });

  it('never mutates the input array or its entries', () => {
    const snapshot = JSON.parse(JSON.stringify(pending));

    const { stillPending } = resume(pending, CHANGE_SET);
    stillPending.push({ event: event('e4', [PARENT]), dependsOn: PARENT, status: DEPENDENCY_PARK_STATUS });

    expect(pending).toEqual(snapshot);
    expect(pending).toHaveLength(3);
  });

  it('round-trips a parked event straight back out', () => {
    const parked = park([], event('e1', [PARENT]), []);
    const landed = [...parked].map((entry) => entry.dependsOn);
    const { stillPending, ready } = resume(parked, landed[0] as string);

    expect(stillPending).toEqual([]);
    expect(ready).toEqual([{ eventId: 'e1', dependsOn: [PARENT] }]);
  });
});