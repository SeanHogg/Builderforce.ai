import { describe, it, expect, vi } from 'vitest';
import { applyLandedLifecycle, settleLandedFailures, SETTLE_CHUNK_SIZE, SETTLE_CONCURRENCY, type LandedEffectDeps, type LandedRun } from './executionLandedEffects';
import { ExecutionStatus } from '../../domain/shared/types';

/**
 * The shared post-landing fan-out. RuntimeService.update, the read-path orphan repair and the cron
 * reaper all call it, so a status landed by ANY of them owes the same effects. The lane chaining /
 * milestone behaviour of update() itself is pinned in RuntimeService.*.test.ts; this file pins what
 * a reaped (FAILED) run is owed.
 */

const run = (over: Partial<LandedRun> = {}): LandedRun => ({
  id: 42, tenantId: 1, taskId: 7, payload: null, cloudAgentRef: 'agent-x', agentHostId: null, ...over,
});

function makeDeps(taskType = 'task', taskTenantId: number | undefined = 1) {
  const task = {
    status: 'in_progress',
    toPlain: () => ({ id: 7, projectId: 3, taskType, tenantId: taskTenantId }),
    update: vi.fn(),
  };
  const ports = {
    onTaskStatusSync: vi.fn(async () => undefined),
    onRunMilestone: vi.fn(async () => undefined),
    onRunFinalized: vi.fn(async () => undefined),
    onManagedRunStatus: vi.fn(async (info: { fromStatus: string }) => ({ managed: false, toStatus: info.fromStatus })),
    onLaneEntry: vi.fn(async () => undefined),
  };
  const audit = { save: vi.fn(async () => undefined) };
  const tasks = {
    findById: vi.fn(async () => task),
    // Only ticket 7 exists; any other id is simply absent from the batch read.
    findByIdsAcrossTenants: vi.fn(async (ids: number[]) => (ids.includes(7) ? [task] : [])),
    update: vi.fn(async () => task),
  };
  const deps = { tasks, audit, ports } as unknown as LandedEffectDeps;
  return { deps, task, ports, audit, tasks };
}

describe('settleLandedFailures - what a reaped run is owed', () => {
  it('syncs the task lifecycle (terminal stamp), asks the managed callback, attributes the run and narrates `failed`', async () => {
    const { deps, ports, audit } = makeDeps('epic');

    await settleLandedFailures(deps, [{ ...run(), errorMessage: 'timed out' }]);

    expect(ports.onTaskStatusSync).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 7, projectId: 3, fromStatus: 'in_progress', toStatus: 'in_progress', terminal: true, actorAgentRef: 'agent-x',
    }));
    expect(ports.onManagedRunStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', taskId: 7 }));
    expect(ports.onRunFinalized).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', executionId: 42 }));
    expect(ports.onRunMilestone).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'failed', taskType: 'epic', executionId: 42, errorMessage: 'timed out', agentRef: 'agent-x',
    }));
    // A failed run never advances the lane or chains the next lane's agent.
    expect(ports.onLaneEntry).not.toHaveBeenCalled();
    expect(audit.save).toHaveBeenCalledTimes(1);
  });

  it('does not stop at a run whose ticket is gone: later runs are still settled', async () => {
    const { deps, tasks, ports } = makeDeps();

    await settleLandedFailures(deps, [
      { ...run({ id: 1, taskId: 9 }), errorMessage: 'a' },
      { ...run({ id: 2 }), errorMessage: 'b' },
    ]);

    // One batched read for every run's ticket, never one per run.
    expect(tasks.findByIdsAcrossTenants).toHaveBeenCalledTimes(1);
    expect(tasks.findById).not.toHaveBeenCalled();
    expect(ports.onTaskStatusSync).toHaveBeenCalledTimes(1);
    expect(ports.onRunMilestone).toHaveBeenCalledWith(expect.objectContaining({ executionId: 2 }));
  });

  it('a failing effect is isolated: the remaining effects still run', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps, ports } = makeDeps();
    ports.onTaskStatusSync.mockRejectedValue(new Error('metrics down'));

    await settleLandedFailures(deps, [{ ...run(), errorMessage: 'x' }]);

    expect(ports.onRunMilestone).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('a COMPLETED Validator review run holds its lane and stays silent, but still records the terminal signal', async () => {
    const { deps, ports } = makeDeps();
    const res = await applyLandedLifecycle(
      deps,
      run({ payload: JSON.stringify({ validatorReview: true }) }),
      { status: ExecutionStatus.COMPLETED, result: 'verdict' },
    );

    expect(res.movedTicket).toBe(false);
    expect(ports.onRunMilestone).not.toHaveBeenCalled();
    expect(ports.onManagedRunStatus).not.toHaveBeenCalled();
    expect(ports.onTaskStatusSync).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, fromStatus: 'in_progress', toStatus: 'in_progress' }));
  });

  it('regression: a FAILED Validator review run (e.g. an orphan reap) still posts the failed milestone, on the shared landing path', async () => {
    const { deps, ports } = makeDeps();
    const res = await applyLandedLifecycle(
      deps,
      run({ payload: JSON.stringify({ validatorReview: true }) }),
      { status: ExecutionStatus.FAILED, errorMessage: 'x' },
    );

    expect(res.movedTicket).toBe(false);
    expect(ports.onRunMilestone).toHaveBeenCalledWith(expect.objectContaining({ phase: 'failed', executionId: 42, errorMessage: 'x' }));
    // The review still holds its lane and does not reach the managed callback.
    expect(ports.onManagedRunStatus).not.toHaveBeenCalled();
    expect(ports.onTaskStatusSync).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, fromStatus: 'in_progress', toStatus: 'in_progress' }));
  });

  it('skips a ticket owned by another tenant: the cross-tenant batch read is never acted on', async () => {
    const { deps, ports, audit } = makeDeps('task', 99);

    await settleLandedFailures(deps, [{ ...run({ tenantId: 1 }), errorMessage: 'x' }]);

    expect(ports.onTaskStatusSync).not.toHaveBeenCalled();
    expect(ports.onRunMilestone).not.toHaveBeenCalled();
    // The run's own audit row is still owed.
    expect(audit.save).toHaveBeenCalledTimes(1);
  });

  it('settles a large reap in bounded chunks with bounded concurrency, and settles EVERY run', async () => {
    const { deps, tasks, ports } = makeDeps();
    let inFlight = 0;
    let peak = 0;
    ports.onTaskStatusSync.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    });
    const total = SETTLE_CHUNK_SIZE * 2 + 30;
    const runs = Array.from({ length: total }, (_, i) => ({ ...run({ id: i + 1 }), errorMessage: 'x' }));

    await settleLandedFailures(deps, runs);

    expect(ports.onTaskStatusSync).toHaveBeenCalledTimes(total);
    expect(peak).toBeLessThanOrEqual(SETTLE_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
    // One batched ticket read per chunk, never one per run.
    expect(tasks.findByIdsAcrossTenants).toHaveBeenCalledTimes(3);
  });
});
