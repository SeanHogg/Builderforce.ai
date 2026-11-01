/**
 * processPendingCloudWorkflows — re-signals the KV-gated cron tick only for work it can do next
 * time (the budget ran out, or a `sleep` timer is close), and never for a run that cannot progress.
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeCronKv } from '../runtime/__fixtures__/fakeCronKv';

let fakeDb: unknown;
vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildDatabase: () => fakeDb,
}));

import { earliestSleepWakeMs, processPendingCloudWorkflows } from './cloudExecutor';

interface TaskSpec {
  id: string;
  status?: string;
  kind: string;
  config?: Record<string, unknown>;
  dependsOn?: string[];
  notBefore?: Date | null;
}

const task = (t: TaskSpec) => ({
  id: t.id, workflowId: 'w1', agentRole: 'worker', description: t.id, status: t.status ?? 'pending',
  input: JSON.stringify({ kind: t.kind, config: t.config ?? {} }), output: null, error: null,
  dependsOn: JSON.stringify(t.dependsOn ?? []), notBefore: t.notBefore ?? null,
  startedAt: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(),
});

/** One cloud workflow `w1` whose task rows are `tasks`; every write is accepted and ignored. */
function useWorkflow(tasks: TaskSpec[] | null) {
  const rows = (tasks ?? []).map(task);
  const result = (data: unknown[]) => Object.assign(Promise.resolve(data), { limit: async () => data });
  fakeDb = {
    select: (fields?: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          if (!fields) return result(rows); // the workflow's task rows
          if ('tenantId' in fields) return result([{ tenantId: 1, workflowDefinitionId: null, status: 'running' }]);
          if ('id' in fields) return result(tasks ? [{ id: 'w1' }] : []); // the pending cloud workflows
          return result(rows.map((r) => ({ status: r.status }))); // post-pass status roll-up
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    execute: async () => ({ rows: [] }),
  };
}

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);

describe('processPendingCloudWorkflows — cron gate', () => {
  it('signals while a sleep node wakes inside the next tick or two', async () => {
    const { env, signalled } = fakeCronKv();
    useWorkflow([{ id: 'nap', kind: 'sleep', notBefore: inMinutes(2) }]);
    await processPendingCloudWorkflows(env);
    expect(signalled()).toBe(true);
  });

  it('signals right after a sleep node ARMS its timer (a zero-second sleep wakes at once)', async () => {
    const { env, signalled } = fakeCronKv();
    useWorkflow([{ id: 'nap', kind: 'sleep', config: { seconds: 0 } }]);
    await processPendingCloudWorkflows(env);
    expect(signalled()).toBe(true);
  });

  it('does NOT signal for a sleep node whose timer is far away — the floor sweep covers it', async () => {
    const { env, signalled } = fakeCronKv();
    useWorkflow([{ id: 'nap', kind: 'sleep', notBefore: inMinutes(3 * 60) }]);
    await processPendingCloudWorkflows(env);
    expect(signalled()).toBe(false);
  });

  it('does NOT signal when no cloud workflow is pending or running', async () => {
    const { env, signalled } = fakeCronKv();
    useWorkflow(null);
    await processPendingCloudWorkflows(env);
    expect(signalled()).toBe(false);
  });

  it('does NOT signal for a run that can never progress (its dependency never settles)', async () => {
    const { env, signalled } = fakeCronKv();
    useWorkflow([
      { id: 'stuck', kind: 'trigger', status: 'running' }, // left `running` by a killed Worker
      { id: 'next', kind: 'trigger', dependsOn: ['stuck'] },
    ]);
    await processPendingCloudWorkflows(env);
    expect(signalled()).toBe(false);
  });

  it('signals when the per-tick budget ran out with ready tasks still pending', async () => {
    const { env, signalled } = fakeCronKv();
    useWorkflow([{ id: 'a', kind: 'trigger' }, { id: 'b', kind: 'trigger' }]);
    await processPendingCloudWorkflows(env, 1);
    expect(signalled()).toBe(true);
  });

  it('does NOT signal when the budget was not exhausted', async () => {
    const { env, signalled } = fakeCronKv();
    useWorkflow([{ id: 'a', kind: 'trigger' }]);
    await processPendingCloudWorkflows(env, 50);
    expect(signalled()).toBe(false);
  });
});

describe('earliestSleepWakeMs', () => {
  it('is the earliest not_before among PENDING tasks, ignoring settled ones', () => {
    const early = new Date('2026-10-31T10:00:00Z');
    const late = new Date('2026-10-31T11:00:00Z');
    expect(earliestSleepWakeMs([
      { status: 'pending', notBefore: late },
      { status: 'pending', notBefore: early },
      { status: 'completed', notBefore: new Date('2026-10-31T09:00:00Z') },
      { status: 'pending', notBefore: null },
    ])).toBe(early.getTime());
  });

  it('is null when nothing is parked', () => {
    expect(earliestSleepWakeMs([{ status: 'pending', notBefore: null }])).toBeNull();
    expect(earliestSleepWakeMs([])).toBeNull();
  });
});
