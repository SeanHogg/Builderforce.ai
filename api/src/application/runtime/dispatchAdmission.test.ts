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

const state = { limit: 2 as number, counter: 0, rows: [] as Row[], cancelFails: false, noTransaction: false, rankFailsOnce: false, log: [] as string[], timeouts: [] as string[] };

const reset = (limit: number, rows: Array<Partial<Row> & Pick<Row, 'id' | 'taskId'>>) => {
  state.limit = limit;
  state.cancelFails = false;
  state.noTransaction = false;
  state.rankFailsOnce = false;
  state.timeouts = [];
  state.log = [];
  state.counter = 0;
  state.rows = rows.map((r) => ({ status: 'pending', seq: null, ...r }));
  for (const r of state.rows) if (r.seq !== null) state.counter = Math.max(state.counter, r.seq);
};

/** One contender's view of the shared rows (the fake cannot read a WHERE clause, so it is told its own row). */
function dbFor(executionId: number, taskId: number): Db {
  const self = {
    select: (fields: Record<string, unknown>) => {
      if (state.rankFailsOnce) { state.rankFailsOnce = false; throw new Error('lookup failed'); }
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
          state.log.push(values.cloudAdmittedSeq === null ? `clear:${executionId}` : `stamp:${executionId}`);
        },
      }),
    }),
    // The per-tenant advisory lock: recorded, and modelled as a mutex held for the whole transaction body.
    execute: async (q: unknown) => {
      // `SET LOCAL lock_timeout` is the bound on the wait for the lock below; it is noted apart so the lock/stamp order stays readable.
      if (JSON.stringify(q).includes('lock_timeout')) { state.timeouts.push(`${executionId}:${state.log.length}`); return; }
      state.log.push(`lock:${executionId}`);
    },
    transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      if (state.noTransaction) throw new Error('no transaction available');
      const turn = tenantLock.then(() => work(self));
      tenantLock = turn.then(() => undefined, () => undefined);
      return turn;
    },
  };
  return self as unknown as Db;
}

/** Tail of the chain of transactions: each one starts only after the previous one finished (what `pg_advisory_xact_lock` does). */
let tenantLock: Promise<void> = Promise.resolve();

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
    expect(state.rows.filter((r) => RUNNING.has(r.status) && r.seq !== null).map((r) => r.id).sort((a, b) => a - b)).toEqual([5, 11]);
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

  it('regression: Minor 1 - stamp and rank run in ONE transaction under the per-tenant advisory lock, and a refused run releases its stamp inside it', async () => {
    reset(1, [{ id: 1, taskId: 1, seq: 1, status: 'running' }, { id: 2, taskId: 2 }]);
    expect(admissionRefusalOf(await admit(2, 2))).toMatchObject({ code: 'concurrent_run_limit' });
    // lock first, then the stamp, then the refused run's stamp cleared - all before the transaction ended
    expect(state.log).toEqual(['lock:2', 'stamp:2', 'clear:2']);
  });

  it('regression: Minor 1 - contenders for the same tenant are serialised, so a parallel burst still starts exactly the cap', async () => {
    reset(2, [1, 2, 3, 4].map((id) => ({ id, taskId: 100 + id })));
    const results = await Promise.all(state.rows.map((r) => admit(r.id, r.taskId)));
    expect(results.filter((r) => r === null)).toHaveLength(2);
    // never two stamps in a row from different runs: each contender's lock -> stamp (-> clear) is contiguous
    const locks = state.log.filter((e) => e.startsWith('lock:'));
    expect(locks).toHaveLength(4);
    for (let i = 0; i < state.log.length; i++) {
      if (state.log[i]!.startsWith('lock:')) expect(state.log[i + 1]).toBe(`stamp:${state.log[i]!.slice(5)}`);
    }
  });

  it('regression: Minor 2 - the lock wait is bounded (SET LOCAL lock_timeout runs BEFORE the lock, inside the transaction)', async () => {
    reset(1, [{ id: 1, taskId: 1, seq: 1, status: 'running' }, { id: 2, taskId: 2 }]);
    await admit(2, 2);
    expect(state.timeouts).toEqual(['2:0']); // issued before the lock (nothing logged yet)
  });

  it('regression: Minor 2 - a rank error inside the transaction is NOT swallowed into "admitted": it falls back to the unlocked stamp-then-rank, which refuses', async () => {
    reset(1, [{ id: 1, taskId: 1, seq: 1, status: 'running' }, { id: 2, taskId: 2 }]);
    state.rankFailsOnce = true;
    expect(admissionRefusalOf(await admit(2, 2))).toMatchObject({ code: 'concurrent_run_limit' });
    // locked attempt stamped then threw (rolled back in real Postgres); the fallback stamped, ranked and released again
    expect(state.log).toEqual(['lock:2', 'stamp:2', 'stamp:2', 'clear:2']);
  });

  it('when no transaction can be opened it admits without the lock rather than starting the run unchecked', async () => {
    reset(1, [{ id: 1, taskId: 1, seq: 1, status: 'running' }, { id: 2, taskId: 2 }]);
    state.noTransaction = true;
    expect(admissionRefusalOf(await admit(2, 2))).toMatchObject({ code: 'concurrent_run_limit' });
    expect(state.log).toEqual(['stamp:2', 'clear:2']);
  });
});
