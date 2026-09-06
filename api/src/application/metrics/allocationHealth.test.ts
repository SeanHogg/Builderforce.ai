import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_WIP, scoreAllocation } from './allocationHealth';

const human = (userId: string, name: string) => ({
  assignedUserId: userId, assignedUserName: name, assignedAgentHostId: null, assignedHostName: null, assignedAgentRef: null,
});

describe('scoreAllocation', () => {
  it('counts open tasks per member and applies the default ceiling when the profile has none', () => {
    const rows = [human('u1', 'Ada'), human('u1', 'Ada'), human('u2', 'Grace')];
    const [ada, grace] = scoreAllocation(rows, new Map());
    expect(ada).toMatchObject({ memberRef: 'u1', observedWip: 2, maxWip: DEFAULT_MAX_WIP, hasExplicitMax: false, overAllocated: false, utilizationPct: 40 });
    expect(grace).toMatchObject({ memberRef: 'u2', observedWip: 1, utilizationPct: 20 });
  });

  it('honours an explicit ceiling and ranks the over-allocated member first', () => {
    const rows = [human('u1', 'Ada'), human('u2', 'Grace'), human('u2', 'Grace'), human('u2', 'Grace')];
    const out = scoreAllocation(rows, new Map([['human:u2', { maxWip: 2 }], ['human:u1', { maxWip: null }]]));
    expect(out[0]).toMatchObject({ memberRef: 'u2', maxWip: 2, hasExplicitMax: true, observedWip: 3, overAllocated: true, utilizationPct: 150 });
    expect(out[1]).toMatchObject({ memberRef: 'u1', hasExplicitMax: false });
  });

  it('skips rows with no resolvable assignee', () => {
    const unassigned = { assignedUserId: null, assignedUserName: null, assignedAgentHostId: null, assignedHostName: null, assignedAgentRef: null };
    expect(scoreAllocation([unassigned], new Map())).toEqual([]);
  });
});
