import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { computePendingApprovalCount } from './pendingApprovalCount';

type Row = { actionType: string; requestedBy: string | null; createdAt: Date };

/** The one chain the tally issues: select → from → where → orderBy → limit. */
function fakeDb(rows: Row[]): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => rows,
  };
  return { select: () => chain } as unknown as Db;
}

const DAY = 86_400_000;

describe('computePendingApprovalCount', () => {
  it('counts visible pending rows and keeps only recent createdAt', async () => {
    const now = Date.now();
    const rows: Row[] = [
      { actionType: 'task.execution', requestedBy: 'host-1', createdAt: new Date(now - 1 * DAY) },
      { actionType: 'task.execution', requestedBy: 'host-1', createdAt: new Date(now - 3 * DAY) },
      { actionType: 'task.execution', requestedBy: 'host-1', createdAt: new Date(now - 40 * DAY) },
    ];
    const tally = await computePendingApprovalCount(fakeDb(rows), 1, 'user-a');
    expect(tally.pending).toBe(3);
    expect(tally.recentCreatedAt).toHaveLength(2);
  });

  it("excludes someone else's self-owned approvals, like the list does", async () => {
    const now = Date.now();
    const rows: Row[] = [
      { actionType: 'synapse.step', requestedBy: 'user-b', createdAt: new Date(now) },
      { actionType: 'synapse.step', requestedBy: 'user-a', createdAt: new Date(now) },
      { actionType: 'task.execution', requestedBy: 'host-1', createdAt: new Date(now) },
    ];
    const tally = await computePendingApprovalCount(fakeDb(rows), 1, 'user-a');
    expect(tally.pending).toBe(2);
  });

  it('returns zero for an empty queue', async () => {
    const tally = await computePendingApprovalCount(fakeDb([]), 1, undefined);
    expect(tally).toEqual({ pending: 0, recentCreatedAt: [] });
  });
});
