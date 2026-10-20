/**
 * `materializeChildTasks` must not put its post-create rollup in front of the caller.
 *
 * The child rows and the `created` count are the contract and stay inline: `created` is
 * what the parent ticket's %-complete rollup is built on, and the HTTP response is
 * `{ created }`. The cache `bump` (task version token, task context, project version
 * token) also stays inline, right after the child rows, so the client's immediate
 * re-read sees the new children. What moves off the call is `syncStates` (re-read the
 * manifest and the append-only sign-off ledger, recompute each slot, rewrite the rows
 * that changed) followed by a second `bump` — un-bounded multi-hop DB work that does
 * not change the number being returned.
 *
 * What must hold:
 *   • with a `waitUntil` on the request scope, the call returns while the rollup is still
 *     pending, and the pending work is the thing handed to `waitUntil`;
 *   • with NO invocation to attach to, the rollup is awaited inline, so a caller that
 *     relies on a settled rollup behaves exactly as before;
 *   • a deferred rollup that fails is reported, never rethrown — after the response there
 *     is no caller left, and an unhandled rejection kills the Worker isolate.
 *
 * `syncStates` is safe to finish a moment late: it is a pure re-derivation from the ledger
 * and the child task's status, so the next write event recomputes the same answer. The
 * brief window of stale participant state is the same staleness a cached read already has.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { tasks, ticketParticipants, ticketRoleSignoffs } from '../../infrastructure/database/schema';
import { TicketParticipantsService } from './ticketParticipants';
import { runInRequestScope, type RequestScope } from '../shared/requestScope';
import { getCacheVersion } from '../../infrastructure/cache/readThroughCache';
import {
  configureCaughtErrorReporter,
  resetCaughtErrorReporterForTests,
  type CaughtErrorRecord,
} from '../observability/caughtErrorReporter';

const TASK_ID = 42;
const TENANT_ID = 5;

/** One staffed, not-yet-materialized participant — exactly one child gets created. */
const PARTICIPANTS = [
  { id: 'p1', taskId: TASK_ID, roleKey: 'developer', assigneeKind: 'agent', assigneeRef: 'ada', childTaskId: null, stageKey: null, state: 'assigned', signoffId: null, required: true },
];

/**
 * A Drizzle stand-in whose reads answer per table, and whose participant reads can be
 * held open. `holdParticipants` is how a test proves the rollup was not awaited: the
 * rollup's first act is `syncStates`, whose first read is the participants table.
 */
function dbStub(opts: { holdParticipants?: Promise<void> } = {}) {
  const chain = (rows: unknown[]) => {
    const value: Record<string, unknown> = {};
    const self = () => value;
    value.from = self;
    value.where = self;
    value.orderBy = self;
    value.limit = async () => rows;
    value.then = (resolve: (result: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return value;
  };
  const rowsFor = (table: unknown): unknown[] => {
    if (table === ticketParticipants) return PARTICIPANTS;
    if (table === ticketRoleSignoffs) return [];
    if (table === tasks) return [{ id: TASK_ID, projectId: 12, title: 'Ship the thing', status: 'todo' }];
    return [];
  };
  let participantReads = 0;
  return {
    participantReads: () => participantReads,
    batch: vi.fn(async () => []),
    select: vi.fn(() => ({
      ...chain([]),
      from: (table: unknown) => {
        const rows = rowsFor(table);
        const held = table === ticketParticipants ? ++participantReads > 1 : false;
        const base = chain(rows);
        if (held && opts.holdParticipants) {
          const gate = opts.holdParticipants;
          base.then = (resolve: (result: unknown) => unknown) =>
            gate.then(() => Promise.resolve(rows).then(resolve));
        }
        return base;
      },
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
  } as unknown as Db & { participantReads: () => number };
}

/** A child create that answers immediately. */
const createChild = async () => ({ id: 900 });

afterEach(() => {
  resetCaughtErrorReporterForTests();
});

/** Run `work` inside a scope and surface the unhandled rejections it produced. */
async function runWithScope<T>(scope: RequestScope, work: () => Promise<T>): Promise<{ result: T; unhandled: unknown[] }> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const result = await runInRequestScope(scope, work);
    // Give a rejection that escaped its promise a tick to surface.
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    return { result, unhandled };
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
}

describe('materializeChildTasks: the syncStates + bump rollup is off the call', () => {
  it('returns created while the rollup is still pending, and hands the rollup to waitUntil', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const db = dbStub({ holdParticipants: gate });
    const waited: Array<Promise<unknown>> = [];

    const { result } = await runWithScope(
      { env: {}, waitUntil: (task) => { waited.push(task); } },
      () => new TicketParticipantsService(db).materializeChildTasks({} as never, TENANT_ID, TASK_ID, createChild),
    );

    // The count came back before the rollup's first read settled.
    expect(result).toBe(1);
    expect(waited).toHaveLength(1);
    // And what was deferred is exactly the rollup: it is the thing waiting on the gate.
    let settled = false;
    void waited[0]?.then(() => { settled = true; });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(settled).toBe(false);

    release();
    await Promise.all(waited);
    expect(settled).toBe(true);
  });

  it('bumps the ticket cache INLINE, before returning, even while the deferred syncStates is pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const db = dbStub({ holdParticipants: gate });
    const waited: Array<Promise<unknown>> = [];
    const before = await getCacheVersion({} as never, `participants:task:${TASK_ID}`);

    const { result } = await runWithScope(
      { env: {}, waitUntil: (task) => { waited.push(task); } },
      () => new TicketParticipantsService(db).materializeChildTasks({} as never, TENANT_ID, TASK_ID, createChild),
    );

    expect(result).toBe(1);
    // The version token moved before the response — the client's re-read sees the children.
    expect(await getCacheVersion({} as never, `participants:task:${TASK_ID}`)).not.toBe(before);
    release();
    await Promise.all(waited);
  });

  it('with no waitUntil, awaits the rollup inline and still returns created', async () => {
    const db = dbStub();

    const created = await new TicketParticipantsService(db)
      .materializeChildTasks({} as never, TENANT_ID, TASK_ID, createChild);

    expect(created).toBe(1);
    // The inline rollup re-read the manifest (the link write is the first read, the
    // rollup's `syncStates` the second), so it ran before the count came back.
    expect(db.participantReads()).toBeGreaterThan(1);
  });

  it('a deferred rollup that fails is reported and never becomes an unhandled rejection', async () => {
    const reported: CaughtErrorRecord[] = [];
    configureCaughtErrorReporter(async (record) => { reported.push(record); });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const db = dbStub();
    // The rollup's `syncStates` is the SECOND participants read; failing it is the
    // deferred work throwing after the response.
    let participantReads = 0;
    const failing = db as unknown as { select: ReturnType<typeof vi.fn> };
    failing.select.mockImplementation(() => {
      const from = (table: unknown) => {
        if (table === ticketParticipants && ++participantReads > 1) {
          return { where: () => { throw new Error('ledger unavailable'); }, orderBy: () => ({}) };
        }
        const rows = table === ticketParticipants ? PARTICIPANTS
          : table === tasks ? [{ id: TASK_ID, projectId: 12, title: 'Ship the thing', status: 'todo' }]
          : [];
        const value: Record<string, unknown> = {};
        const self = () => value;
        value.from = self;
        value.where = self;
        value.orderBy = self;
        value.limit = async () => rows;
        value.then = (resolve: (result: unknown) => unknown) => Promise.resolve(rows).then(resolve);
        return value;
      };
      return { from };
    });

    const waited: Array<Promise<unknown>> = [];
    const { result, unhandled } = await runWithScope(
      { env: {}, waitUntil: (task) => { waited.push(task); } },
      () => new TicketParticipantsService(db).materializeChildTasks({} as never, TENANT_ID, TASK_ID, createChild),
    );

    // The count came back regardless, and nothing escaped as an unhandled rejection.
    // `waited` holds the deferred rollup plus the reporter's own delivery of the
    // failure — `reportCaughtError` attaches its sink the same way — so the claim is
    // "at least the rollup", not an exact count.
    expect(result).toBe(1);
    expect(waited.length).toBeGreaterThanOrEqual(1);
    await Promise.all(waited.map((task) => task.catch(() => undefined)));
    expect(unhandled).toEqual([]);

    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      source: 'application/kanban/ticketParticipants.ts',
      operation: 'materializeChildTasks rollup (deferred)',
      message: 'ledger unavailable',
      handled: true,
      context: { taskId: TASK_ID, tenantId: TENANT_ID },
    });
  });

  it('returns zero and does no rollup when nothing was materialized', async () => {
    const db = dbStub();
    const none = async () => { throw new Error('create failed'); };

    const created = await new TicketParticipantsService(db)
      .materializeChildTasks({} as never, TENANT_ID, TASK_ID, none);

    expect(created).toBe(0);
    // One participants read (the roster), and no second one — the rollup never started.
    expect(db.participantReads()).toBe(1);
  });
});
