import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateRuntimeDashboard, readRuntimeDashboard, type DashboardExecution } from './runtimeDashboard';
import { bumpExecutionState } from './executionStateVersion';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * {@link readRuntimeDashboard} — the tenant runtime dashboard, aggregated over up
 * to 2,000 executions. It is cached behind the execution-state version token, so
 * repeated loads share one read until any execution changes state.
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

/** A `Db` double answering only the agent-host name read. */
function fakeDb(hosts: Array<{ id: number; name: string }>) {
  let selects = 0;
  const chain = {
    from: () => chain,
    where: () => chain,
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(hosts).then(resolve, reject),
  };
  const db = { select: () => { selects += 1; return chain; } } as unknown as Db;
  return { db, selects: () => selects };
}

const at = (iso: string) => new Date(iso);

const SAMPLE: DashboardExecution[] = [
  { status: 'completed', agentHostId: 7, startedAt: at('2026-10-01T00:00:00Z'), completedAt: at('2026-10-01T00:00:10Z'), createdAt: at('2026-10-01T00:00:00Z') },
  { status: 'failed', agentHostId: 7, startedAt: at('2026-10-02T00:00:00Z'), completedAt: at('2026-10-02T00:00:30Z'), createdAt: at('2026-10-02T00:00:00Z') },
  { status: 'submitted', agentHostId: 9, startedAt: null, completedAt: null, createdAt: at('2026-10-03T00:00:00Z') },
  { status: 'running', agentHostId: null, startedAt: at('2026-10-04T00:00:00Z'), completedAt: null, createdAt: at('2026-10-04T00:00:00Z') },
  { status: 'cancelled', agentHostId: null, startedAt: null, completedAt: at('2026-10-05T00:00:00Z'), createdAt: at('2026-10-05T00:00:00Z') },
];

beforeEach(() => __clearL1CacheForTests());

describe('aggregateRuntimeDashboard', () => {
  it('totals statuses, success rate and mean duration over the sample', () => {
    const { totals, agentHostStats } = aggregateRuntimeDashboard(SAMPLE);
    expect(totals).toEqual({
      totalExecutions: 5, pending: 0, submitted: 1, running: 1, completed: 1, failed: 1, cancelled: 1,
      successRate: 1 / 3, avgDurationMs: 20_000,
    });
    expect(agentHostStats.get(7)).toMatchObject({ totalExecutions: 2, completed: 1, failed: 1, lastExecutionAt: '2026-10-02T00:00:00.000Z' });
    // `submitted` counts as pending on the per-host breakdown.
    expect(agentHostStats.get(9)).toMatchObject({ totalExecutions: 1, pending: 1 });
  });

  it('answers zeros for an empty sample', () => {
    const { totals, agentHostStats } = aggregateRuntimeDashboard([]);
    expect(totals.successRate).toBe(0);
    expect(totals.avgDurationMs).toBe(0);
    expect(agentHostStats.size).toBe(0);
  });
});

describe('readRuntimeDashboard', () => {
  it('names hosts, ranks the busiest first, and falls back for an unknown host', async () => {
    const { db } = fakeDb([{ id: 7, name: 'Build box' }]);
    const dashboard = await readRuntimeDashboard(undefined, db, 1, 500, async () => SAMPLE);
    expect(dashboard.window).toEqual({ sampledExecutions: 5, limit: 500 });
    expect(dashboard.byAgentHost.map((h) => [h.agentHostId, h.name])).toEqual([[7, 'Build box'], [9, 'AgentHost 9']]);
    expect(dashboard.byAgentHost[0]?.successRate).toBe(0.5);
  });

  it('serves a repeated load from cache without listing executions again', async () => {
    const env = fakeEnv();
    const { db } = fakeDb([]);
    const list = vi.fn(async () => SAMPLE);
    const first = await readRuntimeDashboard(env, db, 1, 500, list);
    const second = await readRuntimeDashboard(env, db, 1, 500, list);
    expect(second).toEqual(first);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('keys the cache by limit', async () => {
    const env = fakeEnv();
    const { db } = fakeDb([]);
    const list = vi.fn(async () => SAMPLE);
    await readRuntimeDashboard(env, db, 1, 500, list);
    await readRuntimeDashboard(env, db, 1, 2000, list);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('reloads after an execution state change bumps the version', async () => {
    const env = fakeEnv();
    const { db } = fakeDb([]);
    const list = vi.fn(async () => SAMPLE);
    await readRuntimeDashboard(env, db, 1, 500, list);
    await bumpExecutionState(env, 1);
    await readRuntimeDashboard(env, db, 1, 500, list);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not orphan another tenant\'s cached dashboard', async () => {
    const env = fakeEnv();
    const { db } = fakeDb([]);
    const list = vi.fn(async () => SAMPLE);
    await readRuntimeDashboard(env, db, 1, 500, list);
    await bumpExecutionState(env, 2);
    await readRuntimeDashboard(env, db, 1, 500, list);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
