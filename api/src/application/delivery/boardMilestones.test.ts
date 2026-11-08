/**
 * The investor seam's read of delivery: epics completed and releases shipped on a
 * board since a date, each with the points its tickets earned. Database doubled.
 */
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { listBoardMilestonesSince } from './boardMilestones';

const since = new Date('2026-11-01T00:00:00Z');

describe('listBoardMilestonesSince', () => {
  it('returns nothing, in two reads, when no epic or release landed', async () => {
    const db = fakeDb([[], []]);
    expect(await listBoardMilestonesSince(db as unknown as Db, { tenantId: 7, since })).toEqual([]);
    expect(db.calls).toHaveLength(2);
  });

  it('merges epics and releases newest-first and totals the points their tickets earned', async () => {
    const db = fakeDb([
      [{ id: 10, title: 'Checkout', at: new Date('2026-11-03T00:00:00Z'), boardId: 'b1', boardName: 'Web' }],
      [{ id: 'rel-1', name: 'Launch', version: '1.0', at: new Date('2026-11-05T00:00:00Z'), boardId: 'b1', boardName: 'Web' }],
      // recursive descendants of epic 10 (task 4 sits under sub-epic 2), then the release's members
      [
        { root_id: 10, id: 1 },
        { root_id: 10, id: 2 },
        { root_id: 10, id: 4 },
      ],
      [{ id: 3, releaseId: 'rel-1' }],
      [
        { reference: 'board-earn:1', amount: '3.000000' },
        { reference: 'board-earn:2', amount: '2.000000' },
        { reference: 'board-earn:3', amount: '1.000000' },
        { reference: 'board-earn:4', amount: '4.000000' },
      ],
    ]);

    const out = await listBoardMilestonesSince(db as unknown as Db, { tenantId: 7, since });

    expect(out.map((m) => m.milestone)).toEqual(['Launch 1.0', 'Checkout']);
    expect(out[0]).toMatchObject({ boardId: 'b1', boardName: 'Web', earnedPoints: 1, reachedAt: '2026-11-05T00:00:00.000Z' });
    // nested sub-epic work (task 4) counts toward the epic: 3 + 2 + 4
    expect(out[1]!.earnedPoints).toBe(9);
    expect(out[0]!.releaseId).toBe('rel-1');
    expect(out[0]!.taskId).toBeUndefined();
    expect(out[1]!.taskId).toBe('10');
    expect(out[1]!.releaseId).toBeUndefined();
  });

  it('reports zero earned points for a milestone with no ticket members', async () => {
    const db = fakeDb([
      [{ id: 10, title: 'Empty epic', at: new Date('2026-11-03T00:00:00Z'), boardId: 'b1', boardName: 'Web' }],
      [],
      [],
    ]);
    const out = await listBoardMilestonesSince(db as unknown as Db, { tenantId: 7, since });
    expect(out).toHaveLength(1);
    expect(out[0]!.earnedPoints).toBe(0);
  });

  it('adds an upper bound to both sources when `until` is given, and accepts a limit up to 500', async () => {
    const bounded = fakeDb([[], []]);
    await listBoardMilestonesSince(bounded as unknown as Db, { tenantId: 7, since, until: new Date('2026-11-02T00:00:00Z'), limit: 9999 });
    const open = fakeDb([[], []]);
    await listBoardMilestonesSince(open as unknown as Db, { tenantId: 7, since });
    expect(bounded.calls).toHaveLength(2);
    // Each source carries one more predicate (< until) than the open-ended read, and is ordered + limited in SQL.
    for (const i of [0, 1]) {
      expect(JSON.stringify(bounded.calls[i]!.where).length).toBeGreaterThan(JSON.stringify(open.calls[i]!.where).length);
      expect(bounded.calls[i]!.chain).toEqual(expect.arrayContaining(['orderBy', 'limit']));
    }
  });
});
