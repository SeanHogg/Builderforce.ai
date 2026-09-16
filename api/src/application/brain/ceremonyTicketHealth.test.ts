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

import { ChatTicketService, TICKET_KINDS, rollupChatTicketHealth } from './ChatTicketService';

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
    expect(h).toMatchObject({ kind: 'retro', label: 'Sprint 4 retro', progressPct: 0, exists: true, done: 0, total: 1 });
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

describe('epic health (container, over its children)', () => {
  /**
   * The chip used to stay at 0/5 after the epic shipped because the rollup
   * counted `completed_at` only. The SQL now counts status-done children too;
   * these tests lock the mapping the service applies to that rollup.
   */
  it('reads 5/5 when every child is counted done — even if completed_at was never stamped', async () => {
    queue = [
      [{ id: 2473, title: 'Speech hop', status: 'done', completedAt: new Date() }],
      [{ parentId: 2473, total: 5, done: 5 }],
    ];
    const h = (await service().ticketHealthBatch(1, [{ kind: 'epic', ref: '2473' }])).get('epic:2473')!;
    expect(h).toMatchObject({ kind: 'epic', done: 5, total: 5, progressPct: 100, exists: true, status: 'done' });
  });

  it('stays at 0/5 while children are still open, even if the parent is done', async () => {
    queue = [
      [{ id: 2473, title: 'Speech hop', status: 'done', completedAt: new Date() }],
      [{ parentId: 2473, total: 5, done: 0 }],
    ];
    const h = (await service().ticketHealthBatch(1, [{ kind: 'epic', ref: '2473' }])).get('epic:2473')!;
    expect(h).toMatchObject({ done: 0, total: 5, progressPct: 0, status: 'done' });
  });

  it('mixes closed and open children', async () => {
    queue = [
      [{ id: 1, title: 'Partial', status: 'in_progress', completedAt: null }],
      [{ parentId: 1, total: 5, done: 3 }],
    ];
    const h = (await service().ticketHealthBatch(1, [{ kind: 'epic', ref: '1' }])).get('epic:1')!;
    expect(h).toMatchObject({ done: 3, total: 5, progressPct: 60 });
  });
});

/**
 * A CHAT'S TICKET RAIL HAS TO SAY WHICH EPIC EACH TICKET BELONGS TO.
 *
 * A Brain chat that spawns an epic, three child epics and their tasks rendered every
 * one of them as the same flat chip ("EPIC · BACKLOG · SPAWNED HERE"), so the
 * hierarchy the conversation had just created was invisible. Health now carries the
 * parent work item — and carries it WITHOUT an extra query per link, which is the
 * only way this stays affordable on a chat with a hundred linked tickets.
 */
describe('parent work item on task-tier health', () => {
  it('reports the epic a child task belongs to', async () => {
    queue = [
      [{ id: 2540, title: 'Wire the advisor list', status: 'in_progress', completedAt: null, taskType: 'task', parentTaskId: 2527 }],
      [{ id: 2527, title: 'Advisor directory', taskType: 'epic' }],
    ];
    const h = (await service().ticketHealthBatch(1, [{ kind: 'task', ref: '2540' }])).get('task:2540')!;
    expect(h.parent).toEqual({ kind: 'epic', ref: '2527', label: 'Advisor directory' });
  });

  it('reports no parent for a top-level ticket — and asks the database nothing extra', async () => {
    queue = [[{ id: 2540, title: 'Standalone', status: 'todo', completedAt: null, taskType: 'task', parentTaskId: null }]];
    const h = (await service().ticketHealthBatch(1, [{ kind: 'task', ref: '2540' }])).get('task:2540')!;
    expect(h.parent).toBeUndefined();
    expect(selectCount).toBe(1); // nothing to resolve ⇒ no parent query at all
  });

  it('reports no parent when the parent was deleted or belongs to another tenant', async () => {
    // The parent id is stamped on the row, but it resolves to nothing in this tenant:
    // say nothing rather than invent a hierarchy or leak a cross-tenant title.
    queue = [
      [{ id: 2540, title: 'Orphan', status: 'todo', completedAt: null, taskType: 'task', parentTaskId: 999 }],
      [],
    ];
    const h = (await service().ticketHealthBatch(1, [{ kind: 'task', ref: '2540' }])).get('task:2540')!;
    expect(h.parent).toBeUndefined();
  });

  it('gives a sub-epic the epic above it', async () => {
    queue = [
      [{ id: 2527, title: 'Advisor directory', status: 'backlog', completedAt: null, taskType: 'epic', parentTaskId: 2522 }],
      [{ id: 2522, title: 'Advisor Platform', taskType: 'epic' }],
      [{ parentId: 2527, total: 4, done: 1 }],
    ];
    const h = (await service().ticketHealthBatch(1, [{ kind: 'epic', ref: '2527' }])).get('epic:2527')!;
    expect(h).toMatchObject({ kind: 'epic', done: 1, total: 4 });
    expect(h.parent).toEqual({ kind: 'epic', ref: '2522', label: 'Advisor Platform' });
  });

  it('names a parent already in the batch for free — one query for the whole family', async () => {
    // The epic AND its three tasks are all linked to the chat, so every parent is
    // already among the self rows: resolving them must cost NO extra round trip.
    queue = [
      [
        { id: 2522, title: 'Advisor Platform', status: 'backlog', completedAt: null, taskType: 'epic', parentTaskId: null },
        { id: 2527, title: 'Directory', status: 'backlog', completedAt: null, taskType: 'task', parentTaskId: 2522 },
        { id: 2532, title: 'Matching', status: 'todo', completedAt: null, taskType: 'task', parentTaskId: 2522 },
        { id: 2538, title: 'Billing', status: 'todo', completedAt: null, taskType: 'task', parentTaskId: 2522 },
      ],
      [{ parentId: 2522, total: 3, done: 0 }],
    ];
    const out = await service().ticketHealthBatch(1, [
      { kind: 'epic', ref: '2522' },
      { kind: 'task', ref: '2527' }, { kind: 'task', ref: '2532' }, { kind: 'task', ref: '2538' },
    ]);
    expect(selectCount).toBe(2); // self rows + the epic's child rollup — no parent query
    for (const ref of ['2527', '2532', '2538']) {
      expect(out.get(`task:${ref}`)!.parent).toEqual({ kind: 'epic', ref: '2522', label: 'Advisor Platform' });
    }
    expect(out.get('epic:2522')!.parent).toBeUndefined();
  });
});

/**
 * Incomplete spec/roadmap/retro used to emit `total: 0`, so the chat header
 * dropped them from the denominator ("6 tickets 100% · 4/4" beside two empty
 * 0% chips). They are leaves: one item each, even at 0%.
 */
describe('incomplete spec/roadmap/retro count as one item', () => {
  it('emits total:1 for a draft spec so a 0% ring still counts', async () => {
    queue = [[{ id: '400b7152-cd22-48da-afcb-8a791ac6cdfd', goal: 'Advisor platform', status: 'draft' }]];
    const h = (await service().ticketHealthBatch(1, [{ kind: 'spec', ref: '400b7152-cd22-48da-afcb-8a791ac6cdfd' }]))
      .get('spec:400b7152-cd22-48da-afcb-8a791ac6cdfd')!;
    expect(h).toMatchObject({ progressPct: 0, done: 0, total: 1, exists: true });
  });

  it('emits total:1 for a planned roadmap so a 0% ring still counts', async () => {
    queue = [[{ id: '69584c3f-0b8c-49fe-975a-e40a7e1f0648', title: 'Advisor platform', status: 'planned' }]];
    const h = (await service().ticketHealthBatch(1, [{ kind: 'roadmap', ref: '69584c3f-0b8c-49fe-975a-e40a7e1f0648' }]))
      .get('roadmap:69584c3f-0b8c-49fe-975a-e40a7e1f0648')!;
    expect(h).toMatchObject({ progressPct: 0, done: 0, total: 1, exists: true });
  });

  it('rolls the screenshot mix (4×100% + 2×0% with total:0) to 67% · 4/6', () => {
    // Old servers still emit total:0 for incomplete spec/roadmap. The rollup
    // (and the matching brain-ui aggregate) must treat that as weight 1.
    const mix = [
      { progressPct: 100, done: 1, total: 1 },
      { progressPct: 100, done: 1, total: 1 },
      { progressPct: 0, done: 0, total: 0 },
      { progressPct: 100, done: 1, total: 1 },
      { progressPct: 0, done: 0, total: 0 },
      { progressPct: 100, done: 1, total: 1 },
    ];
    expect(rollupChatTicketHealth(mix)).toEqual({ pct: 67, done: 4, total: 6 });
  });
});
