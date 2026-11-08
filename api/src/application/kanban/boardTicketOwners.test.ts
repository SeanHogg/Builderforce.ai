import { describe, expect, it } from 'vitest';
import { excludeStaffedOwners, listBoardTicketOwners } from './boardTicketOwners';

/** One batched select: the chain is awaited once, however many lanes/hosts there are. */
function fakeDb(rows: unknown[]) {
  let selects = 0;
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'where']) chain[m] = () => chain;
  chain.groupBy = () => Promise.resolve(rows);
  const db = { select: () => { selects += 1; return chain; } };
  return { db: db as never, selects: () => selects };
}

describe('listBoardTicketOwners', () => {
  it('groups owners by lane, marks them via ticket, in ONE query', async () => {
    const { db, selects } = fakeDb([
      { laneId: 'l1', hostId: 5, name: 'Host A', ticketCount: 3 },
      { laneId: 'l1', hostId: 6, name: 'Host B', ticketCount: '1' },
      { laneId: 'l2', hostId: 5, name: 'Host A', ticketCount: 2 },
    ]);
    const out = await listBoardTicketOwners(db, 1, 'board-1');
    expect(selects()).toBe(1);
    expect(out.l1).toEqual([
      { hostId: 5, name: 'Host A', ticketCount: 3, via: 'ticket' },
      { hostId: 6, name: 'Host B', ticketCount: 1, via: 'ticket' },
    ]);
    expect(out.l2).toHaveLength(1);
  });

  it('is empty when no host owns an open ticket', async () => {
    expect(await listBoardTicketOwners(fakeDb([]).db, 1, 'board-1')).toEqual({});
  });
});

describe('excludeStaffedOwners', () => {
  const owner = (hostId: number) => ({ hostId, name: `H${hostId}`, ticketCount: 1, via: 'ticket' as const });

  it('drops a host staffed (remote target) on the SAME lane, keeps it on other lanes', () => {
    const out = excludeStaffedOwners(
      { l1: [owner(5), owner(6)], l2: [owner(5)] },
      { l1: [{ runtime: 'remote', target: '5' }] },
    );
    expect(out).toEqual({ l1: [owner(6)], l2: [owner(5)] });
  });

  it('ignores non-remote assignments and omits lanes left empty', () => {
    const out = excludeStaffedOwners(
      { l1: [owner(5)], l2: [owner(7)] },
      { l1: [{ runtime: 'cloud', target: '5' }], l2: [{ runtime: 'remote', target: '7' }] },
    );
    expect(out).toEqual({ l1: [owner(5)] });
  });
});
