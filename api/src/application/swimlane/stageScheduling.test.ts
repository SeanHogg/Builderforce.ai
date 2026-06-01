import { describe, it, expect } from 'vitest';
import {
  computeReadyDispatches,
  aggregateStageOutcome,
  isStageSettled,
  isTerminalDispatch,
  type SchedulableDispatch,
} from './stageScheduling';

const d = (
  id: string,
  status: SchedulableDispatch['status'],
  dependsOn: string[] = [],
): SchedulableDispatch => ({ id, status, dependsOn });

describe('computeReadyDispatches', () => {
  it('parallel: all blocked-with-no-deps are ready at once', () => {
    const ready = computeReadyDispatches([d('a', 'blocked'), d('b', 'blocked'), d('c', 'blocked')]);
    expect(ready.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('sequential: only the next dispatch whose deps are completed is ready', () => {
    const list = [d('a', 'completed'), d('b', 'blocked', ['a']), d('c', 'blocked', ['b'])];
    expect(computeReadyDispatches(list).map((r) => r.id)).toEqual(['b']);
  });

  it('a dependency that is not yet completed leaves the dependent blocked', () => {
    const list = [d('a', 'running'), d('b', 'blocked', ['a'])];
    expect(computeReadyDispatches(list)).toEqual([]);
  });

  it('a FAILED dependency never satisfies readiness', () => {
    const list = [d('a', 'failed'), d('b', 'blocked', ['a'])];
    expect(computeReadyDispatches(list)).toEqual([]);
  });

  it('multi-dep readiness requires ALL deps completed', () => {
    const list = [
      d('a', 'completed'),
      d('b', 'completed'),
      d('c', 'blocked', ['a', 'b']),
      d('e', 'blocked', ['a', 'd']),
    ];
    expect(computeReadyDispatches(list).map((r) => r.id)).toEqual(['c']);
  });

  it('already-pending/running dispatches are not re-reported as ready', () => {
    expect(computeReadyDispatches([d('a', 'pending'), d('b', 'running')])).toEqual([]);
  });
});

describe('aggregateStageOutcome', () => {
  it('empty stage is a completed pass-through', () => {
    expect(aggregateStageOutcome([])).toBe('completed');
  });

  it('all completed → completed', () => {
    expect(aggregateStageOutcome(['completed', 'completed'])).toBe('completed');
  });

  it('any active work → running', () => {
    expect(aggregateStageOutcome(['completed', 'running'])).toBe('running');
    expect(aggregateStageOutcome(['pending', 'completed'])).toBe('running');
    expect(aggregateStageOutcome(['blocked', 'completed'])).toBe('running');
  });

  it('a failure with no remaining active work → failed (no silent advance)', () => {
    expect(aggregateStageOutcome(['completed', 'failed'])).toBe('failed');
    expect(aggregateStageOutcome(['failed'])).toBe('failed');
    expect(aggregateStageOutcome(['cancelled', 'completed'])).toBe('failed');
  });

  it('a failure WHILE siblings still run stays running until settled', () => {
    expect(aggregateStageOutcome(['failed', 'running'])).toBe('running');
  });
});

describe('isStageSettled / isTerminalDispatch', () => {
  it('settled only when every dispatch is terminal', () => {
    expect(isStageSettled(['completed', 'failed', 'cancelled'])).toBe(true);
    expect(isStageSettled(['completed', 'running'])).toBe(false);
  });

  it('isTerminalDispatch', () => {
    expect(isTerminalDispatch('completed')).toBe(true);
    expect(isTerminalDispatch('failed')).toBe(true);
    expect(isTerminalDispatch('running')).toBe(false);
    expect(isTerminalDispatch('pending')).toBe(false);
  });
});
