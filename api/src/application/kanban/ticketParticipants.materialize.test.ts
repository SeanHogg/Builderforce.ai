/**
 * `materializeWorkItems`: AT MOST ONE fan-out child per role, and never a fan-out of a
 * fan-out child.
 *
 * regression: ~700 of 984 archived tickets in one tenant were `[Role] <title>` copies —
 * one role required in several stages (or by several sources) is several manifest rows,
 * and each row used to get its own child; a replay on a child fanned out grandchildren.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { projects, swimlanes, tasks, ticketParticipants, ticketRoleSignoffs } from '../../infrastructure/database/schema';
import { TicketParticipantsService } from './ticketParticipants';
import { roleDisplayName } from './roleCatalog';
import { runInRequestScope } from '../shared/requestScope';
import {
  configureCaughtErrorReporter,
  resetCaughtErrorReporterForTests,
  type CaughtErrorRecord,
} from '../observability/caughtErrorReporter';

const TASK_ID = 42;
const TENANT_ID = 5;
const PARENT = { id: TASK_ID, projectId: 12, title: 'Ship the thing', status: 'todo', parentTaskId: null, archived: false };
const devTitle = `[${roleDisplayName('developer')}] Ship the thing`;
const child = (id: number, extra: Record<string, unknown> = {}) => ({ id, projectId: 12, title: devTitle, parentTaskId: TASK_ID, archived: false, ...extra });

const participant = (id: string, extra: Record<string, unknown> = {}) => ({
  id, taskId: TASK_ID, stageKey: null, roleKey: 'developer', assigneeKind: 'agent', assigneeRef: 'ada',
  childTaskId: null, state: 'assigned', signoffId: null, required: true, ...extra,
});

/**
 * A Drizzle stand-in answering per table. `batch` records the compare-and-set link writes
 * and answers each with `linkLands` rows (1 = the link landed, 0 = a concurrent
 * materialize got there first); `update(table)` records which tables were written.
 */
function dbStub(opts: { participants: unknown[]; tasks?: unknown[]; lanes?: unknown[]; linkLands?: boolean }) {
  const chain = (rows: unknown[]) => {
    const value: Record<string, unknown> = {};
    const self = () => value;
    value.from = self;
    value.where = self;
    value.innerJoin = self;
    value.orderBy = self;
    value.limit = async () => rows;
    value.then = (resolve: (result: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return value;
  };
  const rowsFor = (table: unknown): unknown[] => {
    if (table === ticketParticipants) return opts.participants;
    if (table === ticketRoleSignoffs) return [];
    if (table === tasks) return opts.tasks ?? [PARENT];
    // findCanonicalBoard's pinned-board read, then the board's lanes.
    if (table === projects) return opts.lanes ? [{ board: { id: 'board-1' } }] : [];
    if (table === swimlanes) return opts.lanes ?? [];
    return [];
  };
  const updatedTables: unknown[] = [];
  const batch = vi.fn(async (writes: unknown[]) => writes.map(() => (opts.linkLands === false ? [] : [{ id: 'linked' }])));
  return {
    batch,
    updatedTables,
    select: vi.fn(() => ({ ...chain([]), from: (table: unknown) => chain(rowsFor(table)) })),
    update: vi.fn((table: unknown) => {
      updatedTables.push(table);
      return { set: vi.fn(() => ({ where: vi.fn(() => Object.assign(Promise.resolve([]), { returning: async () => [] })) })) };
    }),
  } as unknown as Db & { batch: typeof batch; updatedTables: unknown[] };
}

/** Writes in the FIRST batch — the participant links (a later rollup may batch its own). */
const linkWrites = (db: { batch: ReturnType<typeof vi.fn> }): number =>
  (db.batch.mock.calls[0]?.[0] as unknown[] | undefined)?.length ?? 0;

const materialize = (db: Db, createChild: Parameters<TicketParticipantsService['materializeWorkItems']>[3]) =>
  new TicketParticipantsService(db).materializeWorkItems({} as never, TENANT_ID, TASK_ID, createChild);

afterEach(() => {
  resetCaughtErrorReporterForTests();
});

describe('materializeWorkItems: one child per role', () => {
  it('one role required in two stages gets ONE child, and both rows link to it', async () => {
    const db = dbStub({ participants: [participant('p1', { stageKey: 'build' }), participant('p2', { stageKey: 'review', source: 'assessment' })] });
    const createChild = vi.fn(async () => ({ id: 900 }));

    expect(await materialize(db, createChild)).toEqual({ created: 1, linked: 2 });
    expect(createChild).toHaveBeenCalledTimes(1);
    expect(createChild).toHaveBeenCalledWith(expect.objectContaining({ title: devTitle, parentTaskId: TASK_ID, assignedAgentRef: 'ada' }));
    expect(linkWrites(db)).toBe(2);
  });

  it('a second pass creates nothing: a role with a live linked child links its new rows to that child', async () => {
    const db = dbStub({
      participants: [participant('p1', { stageKey: 'build', childTaskId: 900 }), participant('p2', { stageKey: 'review' })],
      tasks: [PARENT, child(900)],
    });
    const createChild = vi.fn(async () => ({ id: 901 }));

    expect(await materialize(db, createChild)).toEqual({ created: 0, linked: 1 });
    expect(createChild).not.toHaveBeenCalled();
  });

  it('a link to an ARCHIVED child is not live: the role falls through to a live same-title child', async () => {
    // 900 is archived (absent from the live-children read); 950 is live and titled for the role.
    const db = dbStub({
      participants: [participant('p1', { childTaskId: 900 }), participant('p2', { stageKey: 'review' })],
      tasks: [PARENT, child(950)],
    });
    const createChild = vi.fn(async () => ({ id: 901 }));

    // Both rows re-link to 950: p1 away from the dead link, p2 from nothing.
    expect(await materialize(db, createChild)).toEqual({ created: 0, linked: 2 });
    expect(createChild).not.toHaveBeenCalled();
  });

  it('an archived same-title child is never reused — a new child is created', async () => {
    const db = dbStub({ participants: [participant('p1')], tasks: [PARENT, child(950, { archived: true })] });
    const createChild = vi.fn(async () => ({ id: 901 }));

    expect(await materialize(db, createChild)).toEqual({ created: 1, linked: 1 });
    expect(createChild).toHaveBeenCalledTimes(1);
  });

  it('reuses a live child already titled `[Role] <title>` (a deleted link) instead of creating another', async () => {
    const db = dbStub({ participants: [participant('p1')], tasks: [PARENT, child(950)] });
    const createChild = vi.fn(async () => ({ id: 901 }));

    expect(await materialize(db, createChild)).toEqual({ created: 0, linked: 1 });
    expect(createChild).not.toHaveBeenCalled();
  });

  it('mixed assignees in one role: ONE child, coordinated by the first-staffed participant in lane order', async () => {
    // `review` sits before `build` on the board, so bob (review) coordinates, whatever the row order.
    const lanes = [{ key: 'review', position: 1 }, { key: 'build', position: 2 }];
    for (const order of [['p1', 'p2'], ['p2', 'p1']] as const) {
      const rows = {
        p1: participant('p1', { stageKey: 'build', assigneeRef: 'ada' }),
        p2: participant('p2', { stageKey: 'review', assigneeKind: 'human', assigneeRef: 'bob' }),
      };
      const db = dbStub({ participants: order.map((k) => rows[k]), lanes });
      const createChild = vi.fn(async () => ({ id: 900 }));

      expect(await materialize(db, createChild)).toEqual({ created: 1, linked: 2 });
      expect(createChild).toHaveBeenCalledTimes(1);
      expect(createChild).toHaveBeenCalledWith(expect.objectContaining({ assignedUserId: 'bob', assignedAgentRef: null }));
    }
  });

  it('distinct roles still get one child each', async () => {
    const db = dbStub({ participants: [participant('p1'), participant('p2', { roleKey: 'qa-tester', assigneeRef: 'qa' }), participant('p3', { roleKey: 'owner', assigneeRef: null, assigneeKind: null })] });
    let next = 900;
    const createChild = vi.fn(async () => ({ id: next++ }));

    expect((await materialize(db, createChild)).created).toBe(2);
  });

  it('a lost compare-and-set race archives the surplus child and reports it', async () => {
    const reported: CaughtErrorRecord[] = [];
    configureCaughtErrorReporter(async (record) => { reported.push(record); });
    // A concurrent materialize linked the row first: the conditional UPDATE returns no row.
    const db = dbStub({ participants: [participant('p1')], linkLands: false });
    const createChild = vi.fn(async () => ({ id: 900 }));

    // The reporter delivers through the request scope's waitUntil.
    const waited: Array<Promise<unknown>> = [];
    const result = await runInRequestScope({ env: {}, waitUntil: (task) => { waited.push(task); } }, () => materialize(db, createChild));
    await Promise.all(waited);

    expect(result).toEqual({ created: 0, linked: 0 });
    expect(db.updatedTables).toContain(tasks);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ operation: 'materializeWorkItems link conflict', context: { taskId: TASK_ID, surplus: [900] } });
  });

  it('a ticket that is itself a fan-out child materializes nothing', async () => {
    const asChild = participant('px', { taskId: 7, childTaskId: TASK_ID });
    const db = dbStub({ participants: [asChild, participant('p1')] });
    const createChild = vi.fn(async () => ({ id: 900 }));

    expect(await materialize(db, createChild)).toEqual({ created: 0, linked: 0, skipped: 'fanout_child' });
    expect(createChild).not.toHaveBeenCalled();
    expect(db.batch).not.toHaveBeenCalled();
  });
});
