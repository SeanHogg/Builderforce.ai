import { describe, expect, it } from 'vitest';
import {
  groupCompletedByAssignee,
  completedByAssigneeCacheKey,
  DONE_CLASS_STATUSES,
  type CompletedTaskRow,
} from './reportRoutes';

/**
 * Locks gap [1253]: the "tasks completed by assignee over a window" rollup.
 * Exercises the pure grouping (the load-bearing part of the report) without a DB:
 * one bucket per assignee — human OR agent (host/cloud) — counts + last-completed,
 * busiest first, with the exactly-one-owner precedence and an `unassigned` fallback.
 */

function row(over: Partial<CompletedTaskRow>): CompletedTaskRow {
  return {
    taskId:              over.taskId ?? 1,
    status:              over.status ?? 'done',
    completedAt:         over.completedAt ?? new Date('2026-06-10T00:00:00Z'),
    assignedUserId:      over.assignedUserId ?? null,
    assignedUserName:    over.assignedUserName ?? null,
    assignedAgentHostId: over.assignedAgentHostId ?? null,
    assignedHostName:    over.assignedHostName ?? null,
    assignedAgentRef:    over.assignedAgentRef ?? null,
  };
}

describe('groupCompletedByAssignee', () => {
  it('groups by assignee and orders by completed desc', () => {
    const rows: CompletedTaskRow[] = [
      row({ taskId: 1, assignedUserId: 'u1', assignedUserName: 'Ada' }),
      row({ taskId: 2, assignedUserId: 'u1', assignedUserName: 'Ada' }),
      row({ taskId: 3, assignedAgentRef: 'ide:42' }),
      row({ taskId: 4, assignedAgentHostId: 7, assignedHostName: 'mac-mini' }),
    ];

    const out = groupCompletedByAssignee(rows);

    expect(out).toHaveLength(3);
    // Ada (2) first, then the two single-completion assignees by name tiebreak.
    expect(out[0]).toMatchObject({ assigneeKind: 'human', assigneeName: 'Ada', completed: 2 });
    expect(out.map((r) => r.completed)).toEqual([2, 1, 1]);
    expect(out.find((r) => r.assigneeKind === 'agent_host')).toMatchObject({
      assigneeName: 'mac-mini',
      completed: 1,
    });
    expect(out.find((r) => r.assigneeKind === 'cloud_agent')).toMatchObject({
      assigneeName: 'ide:42',
      completed: 1,
    });
  });

  it('tracks the most recent completion per assignee', () => {
    const out = groupCompletedByAssignee([
      row({ taskId: 1, assignedUserId: 'u1', assignedUserName: 'Ada', completedAt: new Date('2026-06-01T00:00:00Z') }),
      row({ taskId: 2, assignedUserId: 'u1', assignedUserName: 'Ada', completedAt: new Date('2026-06-09T00:00:00Z') }),
      row({ taskId: 3, assignedUserId: 'u1', assignedUserName: 'Ada', completedAt: new Date('2026-06-05T00:00:00Z') }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.completed).toBe(3);
    expect(out[0]!.lastCompletedAt).toBe(new Date('2026-06-09T00:00:00Z').toISOString());
  });

  it('honours human > host > cloud owner precedence on a multi-set row', () => {
    // A row with all three set (shouldn't happen given the one-owner invariant,
    // but the grouping must be deterministic) resolves to the human.
    const out = groupCompletedByAssignee([
      row({ assignedUserId: 'u1', assignedUserName: 'Ada', assignedAgentHostId: 7, assignedAgentRef: 'ide:42' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.assigneeKind).toBe('human');
  });

  it('buckets owner-less tasks under a single unassigned row', () => {
    const out = groupCompletedByAssignee([row({ taskId: 1 }), row({ taskId: 2 })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ assigneeKind: 'unassigned', assigneeName: 'Unassigned', completed: 2 });
  });

  it('returns nothing for no rows', () => {
    expect(groupCompletedByAssignee([])).toEqual([]);
  });
});

describe('completedByAssigneeCacheKey', () => {
  it('is distinct per tenant, version, and window', () => {
    expect(completedByAssigneeCacheKey(1, 0, 7)).not.toBe(completedByAssigneeCacheKey(2, 0, 7));
    expect(completedByAssigneeCacheKey(1, 0, 7)).not.toBe(completedByAssigneeCacheKey(1, 0, 30));
    // A version bump (task status write) yields a fresh key, ageing out the old one.
    expect(completedByAssigneeCacheKey(1, 0, 7)).not.toBe(completedByAssigneeCacheKey(1, 1, 7));
  });
});

describe('DONE_CLASS_STATUSES', () => {
  it('includes the canonical done lane', () => {
    expect(DONE_CLASS_STATUSES).toContain('done');
  });
});
