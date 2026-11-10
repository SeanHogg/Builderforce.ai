/**
 * The task-scoped live-run read against REAL Postgres (PGlite). `taskHasLiveRun` (merge decisions,
 * draft sweeps) and `liveRunsForTask` (dispatch dedupe) compose ONE predicate, so they cannot
 * disagree about what counts as a live run.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { liveRunsForTask, taskHasLiveRun } from './liveExecutionStatus';

vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

let pg: PGlite;
let db: Db;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`CREATE TABLE executions (
    id serial PRIMARY KEY, tenant_id integer NOT NULL, task_id integer, status varchar(32) NOT NULL,
    mode varchar(16) NOT NULL DEFAULT 'live', parent_execution_id integer)`);
  db = drizzle(pg) as unknown as Db;
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => { await pg.exec('TRUNCATE executions RESTART IDENTITY'); });

async function run(over: { tenant?: number; task?: number; status?: string; mode?: string; parent?: number | null }): Promise<number> {
  const res = await pg.query<{ id: number }>(
    'INSERT INTO executions (tenant_id, task_id, status, mode, parent_execution_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [over.tenant ?? 1, over.task ?? 7, over.status ?? 'running', over.mode ?? 'live', over.parent ?? null],
  );
  return res.rows[0]!.id;
}

describe('the live run of a task', () => {
  it('counts a live-status, live-mode, top-level run of the task in the tenant', async () => {
    const id = await run({});
    expect(await taskHasLiveRun(db, 1, 7)).toBe(true);
    expect(await liveRunsForTask(db, 1, 7)).toEqual([{ id, status: 'running' }]);
  });

  it('regression: a rehearsal run or a sub-agent child does not count as live', async () => {
    const parent = await run({ status: 'completed' });
    await run({ mode: 'rehearsal' });
    await run({ parent });
    expect(await taskHasLiveRun(db, 1, 7)).toBe(false);
    expect(await liveRunsForTask(db, 1, 7)).toEqual([]);
  });

  it('ignores terminal runs, other tasks and other tenants', async () => {
    await run({ status: 'failed' });
    await run({ task: 8 });
    await run({ tenant: 2 });
    expect(await taskHasLiveRun(db, 1, 7)).toBe(false);
  });

  it('lists live runs oldest first', async () => {
    const a = await run({ status: 'paused' });
    const b = await run({ status: 'pending' });
    expect((await liveRunsForTask(db, 1, 7)).map((r) => r.id)).toEqual([a, b]);
  });
});
