import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * "Exact 100 is the only completion signal, and only a CLOSED ticket emits it" — for the
 * non-task kinds a chat can be tied to. Each kind is closed by its OWN status words
 * (agent-loop `TICKET_CLOSED_STATES`): an initiative still `active` with every child task
 * done used to read 100 while the initiative itself was open.
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import { CLAIMED_COMPLETE_PROGRESS_CAP, TASK_CLOSED_STATUSES, TICKET_CLOSED_STATES } from '@builderforce/agent-loop';
import { SQL_COUNT_DONE } from './taskTierTicketHealth';
import { specStatusEnum } from '../../infrastructure/database/schema';
import { CEREMONY_SESSION_STATUSES, isCeremonySessionDone } from '../../domain/agile/ceremonySession';
import { ChatTicketService } from './ChatTicketService';
import { TICKET_KINDS } from './chatTicketTypes';

// Strategy-tier health queries call resolveSegment(db, tenantId); the fake DB cannot serve it.
vi.mock('../../infrastructure/auth/segmentResolver', () => ({
  resolveSegment: vi.fn().mockResolvedValue('seg_default'),
}));

/** Results the fake hands back, in the order ChatTicketService asks for them. */
let queue: unknown[][] = [];

function makeDb() {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit', 'groupBy']) b[m] = () => b;
    (b as { then: unknown }).then = (resolve: (v: unknown[]) => void) => resolve(queue.shift() ?? []);
    return b;
  };
  return { select: () => builder() } as unknown as ConstructorParameters<typeof ChatTicketService>[0];
}

async function health(kind: string, ref: string) {
  const out = await new ChatTicketService(makeDb(), {} as never).ticketHealthBatch(1, [{ kind, ref }]);
  return out.get(`${kind}:${ref}`)!;
}

beforeEach(() => { queue = []; });

describe('initiative (container over its tasks)', () => {
  it('regression: an active initiative with every child done reads the claimed-complete rung, not 100', async () => {
    queue = [[{ id: 'i1', name: 'Advisor platform', status: 'active' }], [{ initiativeId: 'i1', total: 4, done: 4 }]];
    expect(await health('initiative', 'i1')).toMatchObject({ progressPct: CLAIMED_COMPLETE_PROGRESS_CAP, done: 4, total: 4, status: 'active' });
  });

  it('a completed initiative reads 100 even with children still open', async () => {
    queue = [[{ id: 'i1', name: 'Advisor platform', status: 'completed' }], [{ initiativeId: 'i1', total: 4, done: 2 }]];
    expect(await health('initiative', 'i1')).toMatchObject({ progressPct: 100, done: 2, total: 4 });
  });

  it('a partly done active initiative keeps its raw figure', async () => {
    queue = [[{ id: 'i1', name: 'Advisor platform', status: 'active' }], [{ initiativeId: 'i1', total: 4, done: 1 }]];
    expect((await health('initiative', 'i1')).progressPct).toBe(25);
  });
});

describe('portfolio (container over its initiatives\' tasks)', () => {
  it('regression: an active portfolio with every child done reads the claimed-complete rung, not 100', async () => {
    queue = [[{ id: 'p1', name: 'Growth', status: 'active' }], [{ portfolioId: 'p1', total: 3, done: 3 }]];
    expect((await health('portfolio', 'p1')).progressPct).toBe(CLAIMED_COMPLETE_PROGRESS_CAP);
  });

  it('an archived portfolio reads 100', async () => {
    queue = [[{ id: 'p1', name: 'Growth', status: 'archived' }], [{ portfolioId: 'p1', total: 3, done: 1 }]];
    expect((await health('portfolio', 'p1')).progressPct).toBe(100);
  });
});

describe('objective (key-result rollup)', () => {
  const krAtTarget = { objectiveId: 'o1', metricType: 'number', startValue: 0, targetValue: 10, currentValue: 10, status: 'done' };

  it('regression: an active objective whose key results all hit target reads the claimed-complete rung, not 100', async () => {
    queue = [[{ id: 'o1', title: 'Recurring revenue', status: 'active' }], [krAtTarget, krAtTarget]];
    expect(await health('objective', 'o1')).toMatchObject({ progressPct: CLAIMED_COMPLETE_PROGRESS_CAP, done: 2, total: 2 });
  });

  it('an achieved objective reads 100', async () => {
    queue = [[{ id: 'o1', title: 'Recurring revenue', status: 'achieved' }], [{ ...krAtTarget, currentValue: 5, status: 'on_track' }]];
    expect((await health('objective', 'o1')).progressPct).toBe(100);
  });
});

describe('roadmap / spec (leaves, by their own status)', () => {
  it('a shipped roadmap item and a complete spec read 100', async () => {
    queue = [[{ id: 'r1', title: 'Billing', status: 'shipped' }]];
    expect(await health('roadmap', 'r1')).toMatchObject({ progressPct: 100, done: 1, total: 1 });
    queue = [[{ id: 's1', goal: 'Billing', status: 'complete' }]];
    expect(await health('spec', 's1')).toMatchObject({ progressPct: 100, done: 1, total: 1 });
  });

  it('a task-lane word does not close a spec, and an in-progress roadmap item stays 50', async () => {
    queue = [[{ id: 's1', goal: 'Billing', status: 'in_progress' }]];
    expect((await health('spec', 's1')).progressPct).toBe(50);
    queue = [[{ id: 'r1', title: 'Billing', status: 'in_progress' }]];
    expect((await health('roadmap', 'r1')).progressPct).toBe(50);
  });
});

describe('archived task-tier tickets read closed (#6975)', () => {
  it('regression: an archived task whose lane is still backlog reads archived / 100 / done', async () => {
    queue = [[{ id: 6767, title: 'Archived ticket', status: 'backlog', taskType: 'task', parentTaskId: null, archived: true }]];
    expect(await health('task', '6767')).toMatchObject({ status: 'archived', progressPct: 100, done: 1, total: 1 });
  });

  it('an unarchived backlog task keeps its lane and progress', async () => {
    queue = [[{ id: 6768, title: 'Open ticket', status: 'backlog', taskType: 'task', parentTaskId: null, archived: false }]];
    const h = await health('task', '6768');
    expect(h).toMatchObject({ status: 'backlog', done: 0, total: 1 });
    expect(h.progressPct).toBeLessThan(100);
  });

  it('regression: an archived epic reads archived / 100 whatever its child rollup', async () => {
    queue = [
      [{ id: 6700, title: 'Archived epic', status: 'in_progress', taskType: 'epic', parentTaskId: null, archived: true }],
      [{ parentId: 6700, total: 3, done: 1 }],
    ];
    expect(await health('epic', '6700')).toMatchObject({ status: 'archived', progressPct: 100 });
  });

  it('regression: the child rollup counts an archived child done (archived OR a closed lane)', () => {
    const q = new PgDialect().sqlToQuery(SQL_COUNT_DONE);
    expect(q.sql).toMatch(/CASE WHEN \("tasks"\."archived" = \$1 or lower\(regexp_replace\("tasks"\."status"/);
    expect(q.params).toEqual(expect.arrayContaining([true, ...TASK_CLOSED_STATUSES]));
  });
});

describe('the registry is derived from the real vocabularies', () => {
  it('every spec closed word is a specStatusEnum value', () => {
    for (const word of TICKET_CLOSED_STATES.spec!.closed) expect(specStatusEnum.enumValues).toContain(word);
  });

  it('retro and poker close on every terminal ceremony status, and not on the open one', () => {
    const terminal = CEREMONY_SESSION_STATUSES.filter((s) => s !== 'active');
    expect(terminal.length).toBeGreaterThan(0);
    for (const kind of ['retro', 'poker']) {
      const closed = TICKET_CLOSED_STATES[kind]!.closed;
      for (const status of terminal) expect(closed, `${kind}:${status}`).toContain(status);
      expect(closed).not.toContain('active');
      // The domain's read-side "done" check agrees with the registry.
      for (const status of terminal) expect(isCeremonySessionDone(status)).toBe(true);
      expect(isCeremonySessionDone('active')).toBe(false);
    }
  });

  it('every chat ticket kind declares its closed vocabulary (a new kind cannot silently emit 100 while open)', () => {
    for (const kind of TICKET_KINDS) expect(TICKET_CLOSED_STATES, kind).toHaveProperty(kind);
  });
});
