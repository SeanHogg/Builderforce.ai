import { describe, expect, it } from 'vitest';
import { dominantLane, laneOccupancy } from './laneOccupancy';
import type { LifecycleEvent } from '@/lib/builderforceApi';

/**
 * The defect this covers: a single-value work item rendered as ONE bar, so
 * "eleven days in review" and "eleven days in the backlog" drew identically.
 */

const HOUR = 3_600_000;
const T0 = Date.parse('2026-08-01T00:00:00.000Z');

function move(hoursIn: number, from: string | null, to: string, backward = false): LifecycleEvent {
  return {
    at: new Date(T0 + hoursIn * HOUR).toISOString(),
    kind: 'lane_moved',
    actorKind: 'system',
    actorName: null,
    fromStatus: from,
    toStatus: to,
    isBackward: backward,
    source: 'task_status_transitions',
  } as LifecycleEvent;
}

function other(hoursIn: number): LifecycleEvent {
  return {
    at: new Date(T0 + hoursIn * HOUR).toISOString(),
    kind: 'run_dispatched',
    actorKind: 'cloud_agent',
    actorName: 'builder',
    source: 'executions',
  } as LifecycleEvent;
}

const CREATED = new Date(T0).toISOString();

describe('laneOccupancy', () => {
  it('seeds the first stay from createdAt, not from the first move', () => {
    // The gap between opening a ticket and first touching it is very often the
    // largest block of its life. Starting the clock at the first MOVE would
    // delete it, and delete it in the direction that flatters the team.
    const o = laneOccupancy([move(10, 'backlog', 'in_progress')], CREATED, T0 + 12 * HOUR);
    expect(o.spans[0]).toMatchObject({ lane: 'backlog', from: T0, to: T0 + 10 * HOUR, open: false });
    expect(o.totalByLane.backlog).toBe(10 * HOUR);
  });

  it('closes each stay on the next move and leaves the last one open', () => {
    const o = laneOccupancy(
      [move(2, 'backlog', 'in_progress'), move(6, 'in_progress', 'in_review')],
      CREATED,
      T0 + 8 * HOUR,
    );
    expect(o.spans.map((s) => s.lane)).toEqual(['backlog', 'in_progress', 'in_review']);
    expect(o.spans.map((s) => s.open)).toEqual([false, false, true]);
    expect(o.totalByLane.in_progress).toBe(4 * HOUR);
    expect(o.current?.lane).toBe('in_review');
    expect(o.end).toBe(T0 + 8 * HOUR);
  });

  it('shows a re-entered lane TWICE and marks the second stay as rework', () => {
    const o = laneOccupancy(
      [
        move(2, 'backlog', 'in_progress'),
        move(5, 'in_progress', 'in_review'),
        move(7, 'in_review', 'in_progress', true),
        move(9, 'in_progress', 'done'),
      ],
      CREATED,
      T0 + 9 * HOUR,
    );
    const inProgress = o.spans.filter((s) => s.lane === 'in_progress');
    expect(inProgress).toHaveLength(2);
    expect(inProgress.map((s) => s.rework)).toEqual([false, true]);
    // …and the row order stays first-entered, so the second visit lands on the
    // same swimlane row rather than opening a third one.
    expect(o.lanes).toEqual(['backlog', 'in_progress', 'in_review', 'done']);
    expect(o.totalByLane.in_progress).toBe(3 * HOUR + 2 * HOUR);
  });

  it('ignores events that are not lane moves', () => {
    const o = laneOccupancy([other(1), move(2, 'backlog', 'done'), other(3)], CREATED, T0 + 4 * HOUR);
    expect(o.lanes).toEqual(['backlog', 'done']);
  });

  it('orders out-of-order events by time rather than trusting the array', () => {
    const o = laneOccupancy(
      [move(6, 'in_progress', 'done'), move(2, 'backlog', 'in_progress')],
      CREATED,
      T0 + 6 * HOUR,
    );
    expect(o.lanes).toEqual(['backlog', 'in_progress', 'done']);
  });

  it('falls back to the first move when the ticket has no createdAt', () => {
    const o = laneOccupancy([move(3, 'backlog', 'in_progress')], null, T0 + 4 * HOUR);
    expect(o.start).toBe(T0 + 3 * HOUR);
    expect(o.spans[0]!.lane).toBe('backlog');
  });

  it('returns nothing to draw when there is no usable timestamp at all', () => {
    expect(laneOccupancy([], null, T0).spans).toEqual([]);
    expect(laneOccupancy([], 'not-a-date', T0).lanes).toEqual([]);
  });

  it('never produces a negative span when a clock skews backwards', () => {
    const o = laneOccupancy([move(-2, 'backlog', 'in_progress')], CREATED, T0 + 1 * HOUR);
    for (const s of o.spans) expect(s.to).toBeGreaterThanOrEqual(s.from);
  });

  it('drops a move with no destination rather than inventing a gap', () => {
    const o = laneOccupancy(
      [{ ...move(2, 'backlog', 'x'), toStatus: null } as LifecycleEvent, move(4, 'backlog', 'done')],
      CREATED,
      T0 + 4 * HOUR,
    );
    expect(o.lanes).toEqual(['backlog', 'done']);
    expect(o.totalByLane.backlog).toBe(4 * HOUR);
  });
});

describe('dominantLane', () => {
  it('names the lane that ate the majority of the life', () => {
    const o = laneOccupancy(
      [move(1, 'backlog', 'in_review'), move(11, 'in_review', 'done')],
      CREATED,
      T0 + 11 * HOUR,
    );
    expect(dominantLane(o)?.lane).toBe('in_review');
  });

  it('names nobody when the time is spread evenly', () => {
    const o = laneOccupancy(
      [move(4, 'backlog', 'in_progress'), move(8, 'in_progress', 'in_review')],
      CREATED,
      T0 + 12 * HOUR,
    );
    expect(dominantLane(o)).toBeNull();
  });

  it('returns null rather than dividing by zero on an instant ticket', () => {
    expect(dominantLane(laneOccupancy([], null, T0))).toBeNull();
  });
});
