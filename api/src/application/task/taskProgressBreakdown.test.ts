import { describe, expect, it } from 'vitest';
import { buildTaskProgressBreakdown } from './taskProgressBreakdown';

describe('buildTaskProgressBreakdown', () => {
  it('uses subtask completion when children exist', () => {
    expect(buildTaskProgressBreakdown({ status: 'in_progress', childStatuses: ['done', 'todo', 'done'] }))
      .toMatchObject({ basis: 'subtasks', progressPct: 67, subtasksDone: 2, subtasksTotal: 3 });
  });

  it('reads a cancelled ticket as complete, not 0%', () => {
    expect(buildTaskProgressBreakdown({ status: 'cancelled' }))
      .toMatchObject({ basis: 'status', progressPct: 100 });
    expect(buildTaskProgressBreakdown({ status: 'cancelled', childStatuses: ['todo', 'todo'] }).progressPct).toBe(100);
  });

  it('counts cancelled subtasks toward done', () => {
    expect(buildTaskProgressBreakdown({ status: 'in_progress', childStatuses: ['done', 'cancelled', 'todo', 'todo'] }))
      .toMatchObject({ basis: 'subtasks', progressPct: 50, subtasksDone: 2, subtasksTotal: 4 });
  });

  it('never emits 100 merely because a PR exists', () => {
    expect(buildTaskProgressBreakdown({ status: 'in_review', prStatus: 'merged', codeDelivered: false }))
      .toMatchObject({ basis: 'status', progressPct: 75, codeDelivered: false, prState: 'merged' });
  });

  it('can report delivered merged code as complete before the lane catches up', () => {
    expect(buildTaskProgressBreakdown({ status: 'in_review', prStatus: 'merged', codeDelivered: true, buildStatus: 'success' }))
      .toEqual({ basis: 'pr', progressPct: 100, subtasksDone: 0, subtasksTotal: 0, codeDelivered: true, testsPassing: true, prState: 'merged' });
  });

  it('reports failing and unknown CI honestly', () => {
    expect(buildTaskProgressBreakdown({ status: 'in_progress', buildStatus: 'failure' }).testsPassing).toBe(false);
    expect(buildTaskProgressBreakdown({ status: 'in_progress', buildStatus: null }).testsPassing).toBeNull();
  });
});
