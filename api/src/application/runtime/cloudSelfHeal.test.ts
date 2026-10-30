/**
 * cloudSelfHeal — the ONE self-heal path shared by the cron reaper and the read-path
 * repair (the durable executor lands its own run's crash). A crashed/orphaned cloud
 * run is re-queued ONCE on the durable executor when eligible. Once-only + idempotent:
 * a run already carrying the retry flag is never re-queued.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  isSelfHealEligible,
  buildDurableStartBody,
  dispatchDurableStart,
  selfHealCloudRun,
} from './cloudSelfHeal';
import { toolAuditEvents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

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
}

function makeFakeDb(opts: FakeOpts = {}) {
  const inserts: Array<{ table: unknown; row: Record<string, unknown> }> = [];
  const updates: Array<{ table: unknown; vals: Record<string, unknown> }> = [];
  const prCount = opts.prCount ?? 0;

  const thenable = (value: unknown) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'where', 'limit']) chain[m] = () => chain;
    chain.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(value).then(onF, onR);
    chain.catch = (onR: (e: unknown) => unknown) => Promise.resolve(value).catch(onR);
    return chain;
  };

  const db = {
    // The open-PR count the once-only guard reads.
    select: () => thenable(Array.from({ length: prCount }, (_, i) => ({ id: i }))),
    // The once-only requeue guard reads the UPDATE's affected rows
    // (`.returning({ id })`) to decide whether it won the race against a
    // concurrent cancel, so `where()` records the write and returns a
    // value that is awaitable AND carries `.returning()`.
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table, vals });
          const affected = [{ id: (vals.id as number | undefined) ?? 1 }];
          return {
            returning: () => Promise.resolve(affected),
            then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
              Promise.resolve(affected).then(onF, onR),
            catch: (onR: (e: unknown) => unknown) => Promise.resolve(affected).catch(onR),
          };
        },
      }),
    }),
    // The real drizzle chain: awaitable, `.returning()` (the tool-event append).
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const list = Array.isArray(row) ? row : [row];
        for (const r of list) inserts.push({ table, row: r });
        return Object.assign(Promise.resolve(undefined), {
          returning: async () => list.map((r, i) => ({ id: inserts.length - list.length + i + 1, executionId: r.executionId })),
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
