import { describe, expect, it } from 'vitest';
import {
  computeCompletion, laneRank, pickNearestLineage, rollupChildren,
} from './ticketContext';
import type { OrdinalMap } from './taskLifecycle';

/**
 * Locks the ticket-context math: the headline %-complete a manager reads at the
 * top of the ticket drawer, and the objective-lineage precedence behind "which
 * goal does this serve". The DB fan-out is exercised at the route; what matters
 * here is that the number is defensible.
 */

// The board from the screenshot that prompted this: 9 lanes, `done` terminal.
const BOARD: OrdinalMap = {
  backlog:             { position: 0, isTerminal: false },
  todo:                { position: 1, isTerminal: false },
  requirements:        { position: 2, isTerminal: false },
  in_progress:         { position: 3, isTerminal: false },
  in_review:           { position: 4, isTerminal: false },
  test:                { position: 5, isTerminal: false },
  business_validation: { position: 6, isTerminal: false },
  blocked:             { position: 7, isTerminal: false },
  done:                { position: 8, isTerminal: true },
};

const base = {
  ordinals: BOARD, isEpic: false, childDone: 0, childTotal: 0,
  signoffCompleted: 0, signoffRequired: 0,
};

describe('laneRank', () => {
  it('ranks a lane by board position, not by status string', () => {
    expect(laneRank('in_progress', BOARD)).toEqual({ index: 3, count: 9 });
    expect(laneRank('done', BOARD)).toEqual({ index: 8, count: 9 });
  });

  it('dedupes shared positions so two lanes at the same rank count once', () => {
    const tied: OrdinalMap = {
      a: { position: 0, isTerminal: false },
      b: { position: 1, isTerminal: false },
      c: { position: 1, isTerminal: false },
    };
    expect(laneRank('c', tied)).toEqual({ index: 1, count: 2 });
  });

  it('reports index -1 for a free-form status with no matching lane', () => {
    expect(laneRank('triage', BOARD).index).toBe(-1);
  });
});

describe('computeCompletion', () => {
  it('is 100% on a terminal lane regardless of outstanding sign-offs', () => {
    const c = computeCompletion({ ...base, status: 'done', signoffCompleted: 0, signoffRequired: 10 });
    expect(c.percent).toBe(100);
    expect(c.isTerminal).toBe(true);
  });

  it('does not let late lane position alone claim near-done with zero sign-offs', () => {
    // The reported ticket: lane 4 of 9 (in_progress), 0 of 10 required roles signed.
    const c = computeCompletion({ ...base, status: 'in_progress', signoffCompleted: 0, signoffRequired: 10 });
    // Lane alone would read 38%; halving it against an unsigned manifest is the point.
    expect(c.percent).toBe(19);
    expect(c.basis.map((b) => b.kind)).toEqual(['lane', 'signoff']);
    expect(c.basis.find((b) => b.kind === 'signoff')).toMatchObject({ percent: 0, done: 0, total: 10 });
  });

  it('blends lane and sign-off progress evenly', () => {
    const c = computeCompletion({ ...base, status: 'in_review', signoffCompleted: 5, signoffRequired: 10 });
    // lane 4/8 = 50%, signoff 50% → 50%.
    expect(c.percent).toBe(50);
  });

  it('falls back to lane position alone when the ticket has no required roles', () => {
    const c = computeCompletion({ ...base, status: 'in_review' });
    expect(c.percent).toBe(50);
    expect(c.basis).toHaveLength(1);
    expect(c.basis[0]!.kind).toBe('lane');
  });

  it('measures an Epic by its children, not by the lane it is parked in', () => {
    const c = computeCompletion({ ...base, status: 'in_progress', isEpic: true, childDone: 9, childTotal: 10 });
    expect(c.percent).toBe(90);
    expect(c.basis).toEqual([{ kind: 'children', percent: 90, weight: 1, done: 9, total: 10 }]);
  });

  it('treats a childless Epic like an ordinary ticket', () => {
    const c = computeCompletion({ ...base, status: 'in_review', isEpic: true });
    expect(c.basis[0]!.kind).toBe('lane');
  });

  it('reports 0% with no basis when the board cannot place the status', () => {
    const c = computeCompletion({ ...base, status: 'triage', ordinals: {} });
    expect(c.percent).toBe(0);
    expect(c.basis).toEqual([]);
    expect(c.laneCount).toBe(0);
  });
});

describe('rollupChildren', () => {
  it('counts terminal lanes as done, including a renamed terminal lane', () => {
    const ordinals: OrdinalMap = { ...BOARD, shipped: { position: 9, isTerminal: true } };
    expect(rollupChildren(['done', 'shipped', 'in_progress', 'todo'], ordinals))
      .toEqual({ total: 4, done: 2, percent: 50 });
  });

  it('is 0% for an Epic with no children (never NaN)', () => {
    expect(rollupChildren([], BOARD)).toEqual({ total: 0, done: 0, percent: 0 });
  });
});

describe('pickNearestLineage', () => {
  it('keeps the closest route when one objective is reachable several ways', () => {
    const picked = pickNearestLineage([
      { id: 'o1', via: 'project' as const },
      { id: 'o1', via: 'task' as const },
      { id: 'o2', via: 'initiative' as const },
    ]);
    expect(picked).toHaveLength(2);
    expect(picked.find((p) => p.id === 'o1')?.via).toBe('task');
    expect(picked.find((p) => p.id === 'o2')?.via).toBe('initiative');
  });

  it('prefers an Epic link over a project-scoped objective', () => {
    const picked = pickNearestLineage([
      { id: 'o1', via: 'project' as const },
      { id: 'o1', via: 'epic' as const },
    ]);
    expect(picked[0]!.via).toBe('epic');
  });
});
