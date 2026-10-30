/**
 * cloudSelfHeal — the ONE self-heal path shared by the cron reaper, the read-path
 * repair, and the container crash handlers. A crashed/orphaned cloud run must:
 *   • re-queue ONCE on the durable executor when eligible, else
 *   • fail carrying the REAL reason (so the timeline says why).
 * Once-only + idempotent: a run already carrying the retry flag is never re-queued.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The outcome row is telemetry: a failure to write it is REPORTED and swallowed, so a fake that cannot serve it would pass silently.
// Every landing test below asserts the row WAS written and that nothing was reported.
const reported = vi.hoisted(() => vi.fn());
vi.mock('../observability/caughtErrorReporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../observability/caughtErrorReporter')>()),
  reportCaughtError: reported,
}));

import {
  isSelfHealEligible,
  buildDurableStartBody,
  dispatchDurableStart,
  selfHealCloudRun,
  handleCloudRunCrash,
} from './cloudSelfHeal';
import { executions, toolAuditEvents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { notifyExecutionSubscribers } from './executionEvents';
import { buildExecutionRepository } from '../../buildExecutionRepository';

vi.mock('./executionEvents', async (importOriginal) => ({ ...(await importOriginal<typeof import('./executionEvents')>()), notifyExecutionSubscribers: vi.fn() }));

beforeEach(() => { reported.mockClear(); vi.mocked(notifyExecutionSubscribers).mockClear(); });

// --- pure logic --------------------------------------------------------------

describe('isSelfHealEligible', () => {
  it('is eligible only with a runner bound, no prior retry, and no open PR', () => {
    expect(isSelfHealEligible({ payload: null, openPrCount: 0, hasCloudRunner: true })).toBe(true);
    expect(isSelfHealEligible({ payload: null, openPrCount: 0, hasCloudRunner: false })).toBe(false);
    expect(isSelfHealEligible({ payload: '{"reaperRequeued":true}', openPrCount: 0, hasCloudRunner: true })).toBe(false);
    expect(isSelfHealEligible({ payload: null, openPrCount: 1, hasCloudRunner: true })).toBe(false);
  });
});

describe('buildDurableStartBody', () => {
  it('maps the run context and derives a generic agent label when none', () => {
    expect(buildDurableStartBody({
      executionId: 5, tenantId: 1, projectId: 3, taskId: 9,
      taskTitle: 'T', taskDescription: null, cloudAgentRef: null, payload: '{}',
    })).toEqual({
      executionId: 5, tenantId: 1, projectId: 3, taskId: 9,
      taskTitle: 'T', taskDescription: null, cloudAgentRef: undefined,
      agentLabel: 'BuilderForce Agent', payload: '{}',
    });
  });
  it('labels with the cloud agent ref when present', () => {
    expect(buildDurableStartBody({
      executionId: 5, tenantId: 1, projectId: 3, taskId: 9,
      taskTitle: 'T', taskDescription: 'd', cloudAgentRef: 'bob', payload: '{}',
    }).agentLabel).toBe('Cloud agent bob');
  });
});

// --- fakes -------------------------------------------------------------------

interface FakeOpts {
  prCount?: number;
  runRow?: Record<string, unknown> | null;
  /** The status another writer already landed: the terminal UPDATE then matches no row and `findById` answers this one. */
  alreadyLanded?: 'completed' | 'cancelled';
}

/** A full `executions` row, as the repository maps it. */
const executionRow = (status: string) => ({
  id: 62, taskId: 78, agentId: null, agentRegistrationId: null, agentHostId: null, tenantId: 1, submittedBy: 'u1', sessionId: null, status,
  payload: '{"model":"m"}', source: 'agent', cloudAgentRef: 'bob', result: null, errorMessage: null, produced: null, startedAt: null, completedAt: null,
  createdAt: new Date(0), updatedAt: new Date(0),
});

function makeFakeDb(opts: FakeOpts = {}) {
  const inserts: Array<{ table: unknown; row: Record<string, unknown> }> = [];
  const updates: Array<{ table: unknown; vals: Record<string, unknown> }> = [];
  const prCount = opts.prCount ?? 0;
  const runRow = opts.runRow;

  const thenable = (value: unknown) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'where', 'limit']) chain[m] = () => chain;
    chain.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(value).then(onF, onR);
    chain.catch = (onR: (e: unknown) => unknown) => Promise.resolve(value).catch(onR);
    return chain;
  };

  const db = {
    select: (cols?: Record<string, unknown>) => {
      // `select()` with no columns is the repository's `findById` (the winner's row after a lost landing).
      if (!cols) return thenable(opts.alreadyLanded ? [executionRow(opts.alreadyLanded)] : []);
      const isRunLoad = Object.prototype.hasOwnProperty.call(cols, 'executionId');
      const value = isRunLoad ? (runRow ? [runRow] : []) : Array.from({ length: prCount }, (_, i) => ({ id: i }));
      return thenable(value);
    },
    // The once-only requeue guard reads the UPDATE's affected rows
    // (`.returning({ id })`) to decide whether it won the race against a
    // concurrent cancel, while the fail path just awaits `.where(...)`. The double
    // has to support both shapes, so `where()` records the write and returns a
    // value that is awaitable AND carries `.returning()`.
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table, vals });
          // A terminal write is the repository's `land`: it gets the full row back (RETURNING * - the columns the UPDATE wrote, errorMessage included), or none when another writer landed first.
          const landing = table === executions && typeof vals.status === 'string' && ['completed', 'failed', 'cancelled'].includes(vals.status);
          const affected = landing ? (opts.alreadyLanded ? [] : [{ ...executionRow(vals.status as string), ...Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== undefined)) }]) : [{ id: (vals.id as number | undefined) ?? 1 }];
          return {
            returning: () => Promise.resolve(affected),
            then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
              Promise.resolve(affected).then(onF, onR),
            catch: (onR: (e: unknown) => unknown) => Promise.resolve(affected).catch(onR),
          };
        },
      }),
    }),
    // The real drizzle chain: awaitable, `.returning()` (the tool-event append), and `.onConflictDoNothing().returning()` (the outcome row's insert: the row "wins" unless one is already recorded).
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const list = Array.isArray(row) ? row : [row];
        for (const r of list) inserts.push({ table, row: r });
        return Object.assign(Promise.resolve(undefined), {
          returning: async () => list.map((r, i) => ({ id: inserts.length - list.length + i + 1, executionId: r.executionId })),
          onConflictDoNothing: () => ({ returning: async () => list.map((r) => ({ executionId: r.executionId })) }),
        });
      },
    }),
  } as unknown as Db;

  const rowsFor = (table: unknown) => inserts.filter((i) => i.table === table).map((i) => i.row);
  return { db, inserts, updates, rowsFor };
}

const startMock = vi.fn();
function envWithRunner(ok = true): Env {
  startMock.mockResolvedValue({ ok });
  return { CLOUD_RUNNER: { idFromName: (n: string) => ({ n }), get: () => ({ fetch: startMock }) } } as unknown as Env;
}

const INPUT = {
  executionId: 62, tenantId: 1, projectId: 3, taskId: 78,
  taskTitle: 'Avatar filters', taskDescription: null, cloudAgentRef: 'bob', payload: '{"model":"m"}',
};

// --- dispatch ----------------------------------------------------------------

describe('dispatchDurableStart', () => {
  it('returns false when no durable runner is bound', async () => {
    startMock.mockReset();
    expect(await dispatchDurableStart({} as Env, 1, buildDurableStartBody({ ...INPUT }))).toBe(false);
    expect(startMock).not.toHaveBeenCalled();
  });
  it('POSTs /start and reports the runner ack', async () => {
    startMock.mockReset();
    expect(await dispatchDurableStart(envWithRunner(true), 62, buildDurableStartBody({ ...INPUT }))).toBe(true);
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});

// --- selfHealCloudRun --------------------------------------------------------

describe('selfHealCloudRun', () => {
  it('re-queues an eligible run: marks the retry flag, POSTs /start, records the event', async () => {
    startMock.mockReset();
    const { db, updates, rowsFor } = makeFakeDb({ prCount: 0 });
    const outcome = await selfHealCloudRun(envWithRunner(true), db, { ...INPUT });
    expect(outcome).toBe('requeued');
    // one-retry flag persisted to the payload before kickoff
    expect(JSON.parse(updates[0]!.vals.payload as string).reaperRequeued).toBe(true);
    // kicked off on the durable executor with the retry-flagged payload
    const body = JSON.parse((startMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.executionId).toBe(62);
    expect(JSON.parse(body.payload).reaperRequeued).toBe(true);
    expect(rowsFor(toolAuditEvents)[0]).toMatchObject({ toolName: 'runtime.requeue', executionId: 62 });
  });

  it('is ineligible (no /start) when the run already used its one retry', async () => {
    startMock.mockReset();
    const { db } = makeFakeDb({ prCount: 0 });
    expect(await selfHealCloudRun(envWithRunner(true), db, { ...INPUT, payload: '{"reaperRequeued":true}' })).toBe('ineligible');
    expect(startMock).not.toHaveBeenCalled();
  });

  it('is ineligible when an open PR would be doubled', async () => {
    startMock.mockReset();
    const { db } = makeFakeDb({ prCount: 1 });
    expect(await selfHealCloudRun(envWithRunner(true), db, { ...INPUT })).toBe('ineligible');
    expect(startMock).not.toHaveBeenCalled();
  });
});

// --- handleCloudRunCrash -----------------------------------------------------

const RUN_ROW = {
  executionId: 62, tenantId: 1, payload: '{"model":"m"}', cloudAgentRef: 'bob',
  status: 'running', taskId: 78, taskTitle: 'Avatar filters', taskDescription: null, projectId: 3,
};

describe('handleCloudRunCrash', () => {
  it('no-ops when the run is already terminal', async () => {
    const { db, inserts } = makeFakeDb({ runRow: { ...RUN_ROW, status: 'completed' } });
    expect(await handleCloudRunCrash(envWithRunner(true), db, 62, 'boom', buildExecutionRepository(db))).toBe('noop');
    expect(inserts).toHaveLength(0);
  });

  it('self-heals a crashed run and records a runtime.crash event', async () => {
    startMock.mockReset();
    const { db, rowsFor } = makeFakeDb({ runRow: { ...RUN_ROW }, prCount: 0 });
    expect(await handleCloudRunCrash(envWithRunner(true), db, 62, 'Container run error: OOM', buildExecutionRepository(db))).toBe('requeued');
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(rowsFor(toolAuditEvents).some((r) => r.toolName === 'runtime.crash')).toBe(true);
  });

  it('fails with the REAL reason when self-heal is unavailable (no runner)', async () => {
    const { db, updates, rowsFor } = makeFakeDb({ runRow: { ...RUN_ROW }, prCount: 0 });
    const reason = 'This cloud run\'s runtime crashed: disk full';
    expect(await handleCloudRunCrash({} as Env, db, 62, reason, buildExecutionRepository(db))).toBe('ineligible');
    // the execution row is failed carrying the crash reason
    const failUpdate = updates.find((u) => u.table === executions && u.vals.status === 'failed');
    expect(failUpdate?.vals.errorMessage).toBe(reason);
    // and a run.failed timeline row carries it too
    expect(rowsFor(toolAuditEvents).find((r) => r.toolName === 'run.failed')?.result).toBe(reason);
    // the run's ONE outcome row was written with the landed status (and its run.finished close), and nothing was swallowed
    const outcomes = rowsFor(toolAuditEvents).filter((r) => r.toolName === 'run.outcome');
    expect(outcomes).toHaveLength(1);
    expect(JSON.parse(String(outcomes[0]!.args))).toMatchObject({ entryPoint: 'cloud', terminalStatus: 'failed', reason });
    expect(rowsFor(toolAuditEvents).some((r) => r.toolName === 'run.finished')).toBe(true);
    expect(reported).not.toHaveBeenCalled();
    expect(vi.mocked(notifyExecutionSubscribers)).toHaveBeenCalledWith(62, expect.objectContaining({ type: 'done', status: 'failed' }));
  });

  it('LOSES to a writer that already landed the run: ineligible, no outcome row, no run.failed, no done notify', async () => {
    const { db, rowsFor } = makeFakeDb({ runRow: { ...RUN_ROW }, prCount: 0, alreadyLanded: 'completed' });
    expect(await handleCloudRunCrash({} as Env, db, 62, 'runtime crashed', buildExecutionRepository(db))).toBe('ineligible');
    expect(rowsFor(toolAuditEvents).filter((r) => ['run.outcome', 'run.finished', 'run.failed'].includes(String(r.toolName)))).toEqual([]);
    expect(vi.mocked(notifyExecutionSubscribers)).not.toHaveBeenCalled();
    expect(reported).not.toHaveBeenCalled();
  });
});
