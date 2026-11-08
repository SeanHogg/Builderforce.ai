/**
 * PRD 09 D6 / D8 at the choke point. The point of the admission is that it is race-safe and
 * ranks by ADMISSION order: every contender has ALREADY inserted its row when it asks, and
 * the rank is the `cloud_admitted_seq` it was stamped with, not its id. These tests run the
 * real `admitCloudRun` (stamp -> rank -> settle) against ONE shared row set.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import type { RuntimeService } from './RuntimeService';
import type { Env } from '../../env';

vi.mock('./concurrentRunCap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./concurrentRunCap')>();
  return { ...actual, resolveConcurrentRunLimit: async () => (state.limit < 0 ? null : { limit: state.limit, effectivePlan: 'free' }) };
});
vi.mock('./cloudToolEvents', () => ({ recordCloudToolEvent: async () => undefined }));
vi.mock('./executionEvents', () => ({ notifyExecutionSubscribers: () => undefined }));

import { admissionRefusalOf, admitAfterInsert, admitCloudRun, withAdmissionRefusal } from './dispatchAdmission';

interface Row { id: number; taskId: number; status: string; seq: number | null }
const LIVE = new Set(['pending', 'submitted', 'running', 'paused']);
const RUNNING = new Set(['pending', 'submitted', 'running']);

const state = { limit: 2 as number, counter: 0, rows: [] as Row[], cancelFails: false };

const reset = (limit: number, rows: Array<Partial<Row> & Pick<Row, 'id' | 'taskId'>>) => {
  state.limit = limit;
  state.cancelFails = false;
  state.counter = 0;
  state.rows = rows.map((r) => ({ status: 'pending', seq: null, ...r }));
  for (const r of state.rows) if (r.seq !== null) state.counter = Math.max(state.counter, r.seq);
};

/** One contender's view of the shared rows (the fake cannot read a WHERE clause, so it is told its own row). */
function dbFor(executionId: number, taskId: number): Db {
  return {
    select: (fields: Record<string, unknown>) => {
      const rows = 'status' in fields
        ? state.rows.filter((r) => r.taskId === taskId && LIVE.has(r.status)).sort((a, b) => a.id - b.id).map(({ id, status }) => ({ id, status }))
        : state.rows.filter((r) => r.seq !== null && RUNNING.has(r.status)).sort((a, b) => (a.seq! - b.seq!) || (a.id - b.id)).map(({ id }) => ({ id }));
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'where', 'orderBy', 'limit']) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => resolve(rows);
      return chain;
    },
    update: () => ({
      set: (values: { cloudAdmittedSeq: unknown }) => ({
        where: async () => {
          const row = state.rows.find((r) => r.id === executionId)!;
          row.seq = values.cloudAdmittedSeq === null ? null : ++state.counter;
        },
      }),
    }),
  } as unknown as Db;
}

const runtime = (executionId: number): RuntimeService => ({
  cancel: async () => {
    if (state.cancelFails) throw new Error('cancel failed');
    state.rows.find((r) => r.id === executionId)!.status = 'cancelled';
  },
  getExecution: async () => ({ toPlain: () => ({ id: executionId, status: state.rows.find((r) => r.id === executionId)!.status }) }),
}) as unknown as RuntimeService;

const admit = (executionId: number, taskId: number, cloudBound = true) =>
  admitCloudRun({} as Env, dbFor(executionId, taskId), runtime(executionId), { tenantId: 1, taskId, executionId, cloudBound });

describe('admitCloudRun', () => {
  it('regression: a lower id admitted AFTER a higher one queues behind it (rank by admission, not by id)', async () => {
    // Limit 2: X(5) is live. B(11) is admitted first and starts. A(10) was inserted earlier
    // but is admitted late: ranked by id it would slot in at 1 and start a third run.
    reset(2, [{ id: 5, taskId: 1, seq: 1, status: 'running' }, { id: 10, taskId: 2 }, { id: 11, taskId: 3 }]);
    expect(await admit(11, 3)).toBeNull();
    const late = await admit(10, 2);
    expect(admissionRefusalOf(late)).toMatchObject({ code: 'concurrent_run_limit', limit: 2 });
    expect(state.rows.filter((r) => RUNNING.has(r.status) && r.seq !== null).map((r) => r.id).sort()).toEqual([5, 11]);
  });

  it('regression: N parallel submits against a cap of 2 -> exactly 2 start (D8)', async () => {
    reset(2, [1, 2, 3, 4, 5, 6].map((id) => ({ id, taskId: 100 + id })));
    const results = await Promise.all(state.rows.map((r) => admit(r.id, r.taskId)));
    expect(results.filter((r) => r === null)).toHaveLength(2);
    expect(state.rows.filter((r) => RUNNING.has(r.status))).toHaveLength(2);
    for (const refused of results.filter((r) => r !== null)) {
      expect(admissionRefusalOf(refused)).toMatchObject({ code: 'concurrent_run_limit' });
    }
  });

  it('regression: two parallel admissions for one task -> exactly one starts (D6)', async () => {
    reset(5, [{ id: 10, taskId: 5 }, { id: 11, taskId: 5 }]);
    const results = await Promise.all([admit(10, 5), admit(11, 5)]);
    expect(results[0]).toBeNull();
    expect(admissionRefusalOf(results[1])).toMatchObject({ code: 'execution_already_live', executionId: 10 });
    expect(state.rows.find((r) => r.id === 11)!.status).toBe('cancelled'); // typed, not a failure the breaker counts
  });

  it('a host-bound run is deduped but neither stamped nor counted', async () => {
    reset(1, [{ id: 1, taskId: 1, seq: 1 }, { id: 2, taskId: 2 }]);
    expect(await admit(2, 2, false)).toBeNull();
    expect(state.rows.find((r) => r.id === 2)!.seq).toBeNull();
    reset(1, [{ id: 7, taskId: 9, status: 'running' }, { id: 8, taskId: 9 }]);
    expect(admissionRefusalOf(await admit(8, 9, false))).toMatchObject({ code: 'execution_already_live', executionId: 7 });
  });

  it('a superadmin (no limit) skips the cap rank but never the per-task dedupe', async () => {
    reset(-1, [{ id: 1, taskId: 1, seq: 1 }, { id: 2, taskId: 2, seq: 2 }, { id: 3, taskId: 3 }]); // -1 = unlimited
    expect(await admit(3, 3)).toBeNull();
    reset(-1, [{ id: 7, taskId: 9, status: 'running' }, { id: 8, taskId: 9 }]);
    expect(admissionRefusalOf(await admit(8, 9))).toMatchObject({ code: 'execution_already_live' });
  });

  it('when the refused run cannot be cancelled, its admission stamp is cleared so it stops holding a slot', async () => {
    reset(1, [{ id: 1, taskId: 1, seq: 1, status: 'running' }, { id: 2, taskId: 2 }]);
    state.cancelFails = true;
    expect(admissionRefusalOf(await admit(2, 2))).toMatchObject({ code: 'concurrent_run_limit' });
    expect(state.rows.find((r) => r.id === 2)!.seq).toBeNull();
  });
});

describe('admitAfterInsert', () => {
  it('fails open when the lookup throws', async () => {
    const broken = { select: () => { throw new Error('db down'); } } as unknown as Db;
    expect(await admitAfterInsert(broken, { tenantId: 1, taskId: 1, executionId: 1, limit: 2 })).toBeNull();
  });
});

describe('admission refusal marker', () => {
  it('round-trips through a started execution result, and is absent on a normal one', () => {
    const refusal = { code: 'concurrent_run_limit', limit: 2, current: 2, effectivePlan: 'free', message: 'm' } as const;
    expect(admissionRefusalOf(withAdmissionRefusal({ id: 1, status: 'failed' }, refusal))).toEqual(refusal);
    expect(admissionRefusalOf({ id: 1, status: 'pending' })).toBeNull();
    expect(admissionRefusalOf(undefined)).toBeNull();
  });
});
