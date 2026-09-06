import { describe, expect, it } from 'vitest';
import { rollupAllocation } from './memberInitiativeAlloc';

const day = (iso: string) => new Date(iso);
const task = (taskId: number, userId: string, name: string, initiative: { id: string; name: string } | null, completed = true) => ({
  taskId,
  assignedUserId: userId, assignedUserName: name, assignedAgentHostId: null, assignedHostName: null, assignedAgentRef: null,
  initiativeId: initiative?.id ?? null,
  initiativeName: initiative?.name ?? null,
  createdAt: day('2026-09-01T09:00:00Z'),
  completedAt: completed ? day('2026-09-01T11:00:00Z') : null,
});

describe('rollupAllocation', () => {
  it('folds logged effort into per-member initiative slices with percentages', () => {
    const rows = [
      task(1, 'u1', 'Ada', { id: 'i1', name: 'Search' }),
      task(2, 'u1', 'Ada', { id: 'i2', name: 'Billing' }),
      task(3, 'u1', 'Ada', null),
    ];
    const logged = new Map([[1, 120], [2, 60], [3, 60]]);
    const [ada] = rollupAllocation(rows, logged);
    expect(ada!.totalHours).toBe(4);
    expect(ada!.initiativeCount).toBe(2);
    expect(ada!.slices.map((s) => [s.initiativeId, s.hours, s.pct])).toEqual([['i1', 2, 50], ['i2', 1, 25], ['unassigned', 1, 25]]);
    expect(ada!.slices[2]!.initiativeName).toBe('Unassigned');
  });

  it('prices nothing for an in-flight task without logged time and drops members with no effort', () => {
    const rows = [task(1, 'u1', 'Ada', { id: 'i1', name: 'Search' }, false)];
    expect(rollupAllocation(rows, new Map())).toEqual([]);
  });

  it('orders members by total effort', () => {
    const rows = [task(1, 'u1', 'Ada', null), task(2, 'u2', 'Grace', null)];
    const out = rollupAllocation(rows, new Map([[1, 30], [2, 90]]));
    expect(out.map((m) => m.name)).toEqual(['Grace', 'Ada']);
  });
});
