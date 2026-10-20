import { describe, expect, it, vi } from 'vitest';
import { ACTIVE_RUNS_DEFAULT_LIMIT, ACTIVE_RUNS_MAX_LIMIT, localDayIndex, parseLiveRunsQuery, readActiveRuns } from './activeRuns';
import { fillDailySeries, MAX_ACTIVITY_DAYS } from './runActivity';
import { latestRunPerTaskAgent, type TaskRun } from './taskRunChips';
import { bumpExecutionState } from './executionStateVersion';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * The ONE live-runs read (`GET /api/runtime/active`): bounded query parsing, the
 * `since` version short-circuit that lets a poller skip the payload while nothing
 * moved, and the two pure folds behind its opt-in projections.
 */

function fakeEnv() {
  const store = new Map<string, string>();
  const kv = {
    get: vi.fn(async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null)),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
  };
  return { AUTH_CACHE_KV: kv } as unknown as Env;
}

/** A `Db` double: every builder call chains, and awaiting the chain yields `rows`. */
function fakeDb(rows: unknown[]) {
  let selects = 0;
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'groupBy']) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject);
  const db = { select: () => { selects += 1; return chain; } } as unknown as Db;
  return { db, selects: () => selects };
}

const query = (params: Record<string, string>) => parseLiveRunsQuery((key) => params[key]);

const RUN = {
  id: 1, status: 'running', taskId: 9, taskTitle: 'Ship it', projectId: 3, projectName: 'P',
  agentHostId: null, cloudAgentRef: null, agentName: null, submittedBy: 'u', startedAt: null,
  createdAt: '2026-10-17T00:00:00Z',
};

describe('parseLiveRunsQuery', () => {
  it('defaults to a small active list and no projections', () => {
    expect(query({})).toEqual({ limit: ACTIVE_RUNS_DEFAULT_LIMIT, since: undefined, activityDays: undefined, tzOffsetMinutes: 0, taskRuns: undefined });
  });

  it('bounds limit, window, offset and the task-runs scope', () => {
    const q = query({ limit: '9999', activityDays: '400', tzOffset: '-5000', taskRuns: '42', since: 'abc' });
    expect(q).toMatchObject({ limit: ACTIVE_RUNS_MAX_LIMIT, activityDays: MAX_ACTIVITY_DAYS, tzOffsetMinutes: -840, taskRuns: 42, since: 'abc' });
    expect(query({ taskRuns: 'all' }).taskRuns).toBe('all');
    expect(query({ taskRuns: 'nope', activityDays: '0' })).toMatchObject({ taskRuns: undefined, activityDays: undefined });
  });
});

describe('readActiveRuns', () => {
  it('answers `unchanged` with no database read when `since` is the current version', async () => {
    const env = fakeEnv();
    const { db, selects } = fakeDb([RUN]);
    const first = await readActiveRuns(env, db, 1, query({}));
    expect(first.active).toHaveLength(1);
    expect(first.active?.[0]).toMatchObject({ kind: 'cloud' });
    expect(first.version).toBeTruthy();
    const readsAfterFirst = selects();

    const second = await readActiveRuns(env, db, 1, query({ since: first.version }));
    expect(second).toEqual({ version: first.version, unchanged: true });
    expect(selects()).toBe(readsAfterFirst);
  });

  it('returns the full body again once a run changes state', async () => {
    const env = fakeEnv();
    const { db } = fakeDb([RUN]);
    const first = await readActiveRuns(env, db, 1, query({}));
    await bumpExecutionState(env, 1);
    const next = await readActiveRuns(env, db, 1, query({ since: first.version }));
    expect(next.unchanged).toBeUndefined();
    expect(next.version).not.toBe(first.version);
    expect(next.active).toHaveLength(1);
  });

  it('includes a projection only when asked', async () => {
    const { db } = fakeDb([]);
    const bare = await readActiveRuns(undefined, db, 1, query({}));
    expect(bare).not.toHaveProperty('activity');
    expect(bare).not.toHaveProperty('taskRuns');
    const both = await readActiveRuns(undefined, db, 1, query({ activityDays: '7', taskRuns: '5' }));
    expect(both.activity).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(both.taskRuns).toEqual([]);
  });
});

describe('fillDailySeries', () => {
  it('places counts oldest-first and drops days outside the window', () => {
    expect(fillDailySeries([{ daysAgo: 0, count: 3 }, { daysAgo: 2, count: 1 }, { daysAgo: 9, count: 5 }], 4)).toEqual([0, 1, 0, 3]);
  });
});

describe('latestRunPerTaskAgent', () => {
  const run = (id: number, taskId: number, status: string, agent: Partial<TaskRun>): TaskRun => ({
    id, taskId, status, agentHostId: null, agentId: null, cloudAgentRef: null, createdAt: `2026-10-17T00:00:${String(60 - id).padStart(2, '0')}Z`, ...agent,
  });

  it('keeps the newest run per (task, agent) and every distinct agent', () => {
    const rows = [
      run(4, 1, 'pending', { cloudAgentRef: 'bob' }),
      run(3, 1, 'completed', { cloudAgentRef: 'kevin' }),
      run(2, 1, 'failed', { cloudAgentRef: 'bob' }),
      run(1, 2, 'completed', { agentHostId: 7 }),
    ];
    expect(latestRunPerTaskAgent(rows).map((r) => r.id)).toEqual([4, 3, 1]);
  });
});

describe('localDayIndex — the run-activity cache key rolls over at LOCAL midnight', () => {
  it("changes at the caller's midnight, not UTC's", () => {
    const beforeUtcMidnight = Date.parse('2026-10-19T23:30:00.000Z');
    const afterUtcMidnight = Date.parse('2026-10-20T00:30:00.000Z');
    expect(localDayIndex(afterUtcMidnight, 0)).toBe(localDayIndex(beforeUtcMidnight, 0) + 1);
    // UTC-5 is still on the 19th at 00:30Z.
    expect(localDayIndex(afterUtcMidnight, -300)).toBe(localDayIndex(beforeUtcMidnight, -300));
    // UTC+1 already crossed at 23:00Z.
    expect(localDayIndex(beforeUtcMidnight, 60)).toBe(localDayIndex(beforeUtcMidnight, 0) + 1);
  });
});
