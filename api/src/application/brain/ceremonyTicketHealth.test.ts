import { describe, it, expect, beforeEach } from 'vitest';

/**
 * A RETRO AND AN ESTIMATION SESSION ARE TEAM WORK, SO THEY CARRY HEALTH LIKE ANY
 * OTHER LINKED ITEM.
 *
 * Both were excluded from `TICKET_KINDS` as "ceremony sessions, not health-bearing
 * work items". They are: a team performs them, they have an outcome, and a chat gets
 * opened about them. These tests lock the two DIFFERENT derivations that follow from
 * what each one actually is —
 *
 *   • a retro is a LEAF: its items are observations, not work that completes, so
 *     progress comes from its own status, with the honest middle value that an empty
 *     open retro has not started;
 *   • a poker session is a CONTAINER: its stories are the work and a story is done
 *     when it carries a final estimate, so the ring reads "5 of 8 estimated".
 *
 * — and that both roll up in BATCH: one grouped child query per kind, never one per
 * link, however many ceremonies a chat references.
 */

import { ChatTicketService, TICKET_KINDS } from './ChatTicketService';

/** Results the fake hands back, in the order ChatTicketService asks for them. */
let queue: unknown[][] = [];
/** Every select the service issued — proves the batching claim. */
let selectCount = 0;

function makeDb() {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit', 'groupBy']) b[m] = () => b;
    (b as { then: unknown }).then = (resolve: (v: unknown[]) => void) => resolve(queue.shift() ?? []);
    return b;
  };
  return {
    select: () => { selectCount += 1; return builder(); },
  } as unknown as ConstructorParameters<typeof ChatTicketService>[0];
}

function service() {
  return new ChatTicketService(makeDb(), {} as never);
}

beforeEach(() => { queue = []; selectCount = 0; });

describe('ceremonies are linkable kinds', () => {
  it('registers retro and poker so a chat can be tied to one at all', () => {
    expect(TICKET_KINDS).toContain('retro');
    expect(TICKET_KINDS).toContain('poker');
  });
});

describe('retrospective health (leaf, by its own status)', () => {
  it('reports 0% for an OPEN retro nobody has contributed to yet', async () => {
    // A status-only rule would hand every retro 50% the instant it was created; an
    // empty one has not started, and saying so is the whole point of the ring.
    queue = [[{ id: 'r1', name: 'Sprint 4 retro', status: 'active' }], []];
    const out = await service().ticketHealthBatch(1, [{ kind: 'retro', ref: 'r1' }]);
    const h = out.get('retro:r1')!;
    expect(h).toMatchObject({ kind: 'retro', label: 'Sprint 4 retro', progressPct: 0, exists: true });
  });

  it('reports 50% once the team has actually put something in it', async () => {
    queue = [[{ id: 'r1', name: 'Sprint 4 retro', status: 'active' }], [{ retroId: 'r1', n: 7 }]];
    expect((await service().ticketHealthBatch(1, [{ kind: 'retro', ref: 'r1' }])).get('retro:r1')!.progressPct).toBe(50);
  });

  it('reports 100% once it is closed — the state that was previously unreachable', async () => {
    queue = [[{ id: 'r1', name: 'Sprint 4 retro', status: 'completed' }], [{ retroId: 'r1', n: 7 }]];
    const h = (await service().ticketHealthBatch(1, [{ kind: 'retro', ref: 'r1' }])).get('retro:r1')!;
    expect(h.progressPct).toBe(100);
    expect(h.done).toBe(1);
  });

  it('counts a cancelled retro as finished, not as work still owed', async () => {
    queue = [[{ id: 'r1', name: 'Abandoned', status: 'cancelled' }], []];
    expect((await service().ticketHealthBatch(1, [{ kind: 'retro', ref: 'r1' }])).get('retro:r1')!.progressPct).toBe(100);
  });

  it('marks a deleted retro as gone rather than inventing progress for it', async () => {
    queue = [[], []];
    const h = (await service().ticketHealthBatch(1, [{ kind: 'retro', ref: 'ghost' }])).get('retro:ghost')!;
    expect(h).toMatchObject({ exists: false, progressPct: 0, label: '(deleted)' });
  });
});

describe('poker session health (container, over its stories)', () => {
  it('rolls the ring up from stories that carry a final estimate', async () => {
    queue = [
      [{ id: 'p1', name: 'Sprint 5 estimation', status: 'active' }],
      [{ sessionId: 'p1', total: 8, estimated: 5 }],
    ];
    const h = (await service().ticketHealthBatch(1, [{ kind: 'poker', ref: 'p1' }])).get('poker:p1')!;
    expect(h).toMatchObject({ kind: 'poker', done: 5, total: 8, progressPct: 63, exists: true });
  });

  it('reaches 100% exactly when every story is estimated', async () => {
    queue = [
      [{ id: 'p1', name: 'Sprint 5 estimation', status: 'active' }],
      [{ sessionId: 'p1', total: 4, estimated: 4 }],
    ];
    const h = (await service().ticketHealthBatch(1, [{ kind: 'poker', ref: 'p1' }])).get('poker:p1')!;
    expect(h.progressPct).toBe(100);
    expect(h.done).toBe(h.total);
  });

  it('falls back to its own status when there is nothing to roll up', async () => {
    // No stories yet ⇒ an open session is 0%, and a CLOSED empty one is finished
    // rather than stuck at zero forever.
    queue = [[{ id: 'p1', name: 'Empty', status: 'active' }], []];
    expect((await service().ticketHealthBatch(1, [{ kind: 'poker', ref: 'p1' }])).get('poker:p1')!.progressPct).toBe(0);

    queue = [[{ id: 'p2', name: 'Empty but closed', status: 'completed' }], []];
    expect((await service().ticketHealthBatch(1, [{ kind: 'poker', ref: 'p2' }])).get('poker:p2')!.progressPct).toBe(100);
  });
});

describe('batching', () => {
  /**
   * Health is derived live on every read and is deliberately uncached, so the query
   * count is the thing that has to stay bounded: a chat linked to six ceremonies must
   * cost one parent + one grouped child query per KIND, not one per link.
   */
  it('costs a fixed number of queries however many ceremonies are linked', async () => {
    queue = [
      [{ id: 'r1', name: 'A', status: 'active' }, { id: 'r2', name: 'B', status: 'completed' }, { id: 'r3', name: 'C', status: 'active' }],
      [{ retroId: 'r1', n: 2 }, { retroId: 'r3', n: 1 }],
      [{ id: 'p1', name: 'D', status: 'active' }, { id: 'p2', name: 'E', status: 'active' }, { id: 'p3', name: 'F', status: 'completed' }],
      [{ sessionId: 'p1', total: 2, estimated: 1 }, { sessionId: 'p2', total: 4, estimated: 4 }],
    ];
    const out = await service().ticketHealthBatch(1, [
      { kind: 'retro', ref: 'r1' }, { kind: 'retro', ref: 'r2' }, { kind: 'retro', ref: 'r3' },
      { kind: 'poker', ref: 'p1' }, { kind: 'poker', ref: 'p2' }, { kind: 'poker', ref: 'p3' },
    ]);
    expect(out.size).toBe(6);
    expect(selectCount).toBe(4); // 2 parents + 2 grouped child rollups — not 6+
    expect(out.get('retro:r2')!.progressPct).toBe(100);
    expect(out.get('poker:p2')!.progressPct).toBe(100);
    expect(out.get('poker:p3')!.progressPct).toBe(100); // closed, no stories
  });
});
