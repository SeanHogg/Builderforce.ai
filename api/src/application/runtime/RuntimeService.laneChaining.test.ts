import { describe, it, expect, vi } from 'vitest';
import { RuntimeService } from './RuntimeService';
import { Execution } from '../../domain/execution/Execution';
import { Task } from '../../domain/task/Task';
import { ExecutionStatus, TaskStatus, TaskPriority, TaskType } from '../../domain/shared/types';
import type { IExecutionRepository } from '../../domain/execution/IExecutionRepository';
import type { ITaskRepository } from '../../domain/task/ITaskRepository';
import type { IAgentRepository } from '../../domain/agent/IAgentRepository';
import type { IAuditRepository } from '../../domain/audit/IAuditRepository';

/**
 * Autonomous lane-chaining: when an agent COMPLETES and advances its ticket into
 * the next lane, RuntimeService must fire `onLaneEntry` so that lane's configured
 * agent kicks off — parity with a human board-drag (the reported "next agent
 * doesn't start after an auto-move" bug). The trigger carries `originLaneKey` (the
 * lane the just-completed run served) so the downstream same-lane guard can break
 * the in_review→in_review loop WITHOUT blocking a genuine handoff to a different
 * lane staffed by the same agent.
 */

const TASK_ID = 7;
const EXEC_ID = 42;

function buildTask(status: string): Task {
  const now = new Date();
  return Task.reconstitute({
    id: TASK_ID as never, projectId: 3 as never, key: 'P-001', title: 't', description: null,
    status, priority: TaskPriority.MEDIUM, taskType: TaskType.TASK, parentTaskId: null,
    assignedAgentType: null, githubIssueNumber: null, githubIssueUrl: null, githubPrUrl: null,
    githubPrNumber: null, assignedAgentHostId: null, assignedAgentRef: null, assignedUserId: null,
    gitBranch: null, explicitRepoId: null, sprintId: null, releaseId: null, storyPoints: null,
    businessValue: null, businessValueRationale: null, businessValueSource: null, managerRank: null,
    reviewCount: 0, lastReviewedAt: null, lastReviewVerdict: null, gapOriginTaskId: null,
    startDate: null, dueDate: null, decompositionSource: null,
    persona: null, archived: false, createdAt: now, updatedAt: now,
  });
}

function buildExecution(payload: string | null, status = ExecutionStatus.RUNNING): Execution {
  const now = new Date();
  return Execution.reconstitute({
    id: EXEC_ID as never, taskId: TASK_ID as never, agentId: null, agentHostId: null,
    tenantId: 1 as never, submittedBy: 'system:lane-auto', sessionId: null, status,
    payload, cloudAgentRef: 'agent-dev', result: null, errorMessage: null, produced: null,
    startedAt: now, completedAt: null, createdAt: now, updatedAt: now,
  });
}

type Captured = { status: string; originLaneKey?: string } | null;

function makeService(opts: {
  taskStatus: string;
  payload: string | null;
  produced?: boolean | null;
  nextStatus?: string | null;
  managedToStatus?: string;
  taskSyncFailures?: number;
  laneEntryFailures?: number;
}) {
  let stored = buildTask(opts.taskStatus);
  let storedExecution = Execution.reconstitute({
    ...buildExecution(opts.payload).toPlain(),
    produced: opts.produced ?? null,
  });
  const executions = {
    findById: async () => storedExecution,
    update: async (e: Execution) => { storedExecution = e; return e; },
  } as unknown as IExecutionRepository;
  const tasks = {
    findById: async () => stored,
    update: async (t: Task) => { stored = t; return t; },
  } as unknown as ITaskRepository;
  const agents = {} as IAgentRepository;
  const audit = { save: async () => undefined } as unknown as IAuditRepository;

  let captured: Captured = null;
  let taskSyncCalls = 0;
  let laneEntryCalls = 0;
  let managedRunStatusCalls = 0;
  const onLaneEntry = async (info: { status: string; originLaneKey?: string }) => {
    laneEntryCalls += 1;
    if (laneEntryCalls <= (opts.laneEntryFailures ?? 0)) throw new Error('lane dispatcher unavailable');
    captured = { status: info.status, originLaneKey: info.originLaneKey };
  };
  const onTaskStatusSync = async () => {
    taskSyncCalls += 1;
    if (taskSyncCalls <= (opts.taskSyncFailures ?? 0)) throw new Error('metrics unavailable');
  };
  // When a nextStatus is provided the service is wired WITH the config-driven
  // resolver (mimicking the board having a next swimlane); otherwise it is left
  // undefined so the default in_review path is exercised.
  const resolveNextStatus = opts.nextStatus !== undefined
    ? async () => opts.nextStatus ?? null
    : undefined;
  const onManagedRunStatus = opts.managedToStatus !== undefined
    ? async () => {
        managedRunStatusCalls += 1;
        return { managed: true, toStatus: opts.managedToStatus! };
      }
    : undefined;
  const svc = new RuntimeService(executions, tasks, agents, audit, undefined, onTaskStatusSync, undefined, onLaneEntry, resolveNextStatus, undefined, undefined, onManagedRunStatus);
  return {
    svc,
    getCaptured: () => captured,
    getStored: () => stored,
    getTaskSyncCalls: () => taskSyncCalls,
    getLaneEntryCalls: () => laneEntryCalls,
    getManagedRunStatusCalls: () => managedRunStatusCalls,
    getStoredExecution: () => storedExecution,
  };
}

describe('RuntimeService lane chaining', () => {
  it('fires onLaneEntry on COMPLETED advance, carrying the run’s origin lane', async () => {
    const { svc, getCaptured, getStored } = makeService({
      taskStatus: TaskStatus.IN_PROGRESS, payload: JSON.stringify({ laneKey: 'in_progress' }),
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'done' });
    expect(getStored().status).toBe(TaskStatus.IN_REVIEW);
    expect(getCaptured()).toEqual({ status: TaskStatus.IN_REVIEW, originLaneKey: 'in_progress' });
  });

  it('counts a lane advance as productive even when the run wrote no files', async () => {
    const { svc, getStoredExecution } = makeService({
      taskStatus: TaskStatus.IN_PROGRESS,
      payload: JSON.stringify({ laneKey: 'in_progress' }),
      produced: false,
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'advanced workflow' });
    expect(getStoredExecution().produced).toBe(true);
  });

  it('does not call a completed run productive when its ticket remained in place', async () => {
    const { svc, getStoredExecution } = makeService({
      taskStatus: 'ready',
      payload: JSON.stringify({ laneKey: 'ready', actAsRole: 'business-analyst' }),
      managedToStatus: 'ready',
      produced: false,
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'no accepted change' });
    expect(getStoredExecution().produced).toBe(false);
  });

  it('threads originLaneKey = the destination lane when a run completes back into its own lane (loop case the guard then suppresses)', async () => {
    const { svc, getCaptured } = makeService({
      taskStatus: TaskStatus.IN_PROGRESS, payload: JSON.stringify({ laneKey: 'in_review' }),
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'done' });
    // originLaneKey === status → the same-lane guard in maybeAutoRunOnLaneEntry returns early.
    expect(getCaptured()).toEqual({ status: TaskStatus.IN_REVIEW, originLaneKey: 'in_review' });
  });

  it('leaves originLaneKey undefined for a manual/host run with no stamped payload', async () => {
    const { svc, getCaptured } = makeService({ taskStatus: TaskStatus.IN_PROGRESS, payload: null });
    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'done' });
    expect(getCaptured()).toEqual({ status: TaskStatus.IN_REVIEW, originLaneKey: undefined });
  });

  it('does NOT chain when completion auto-approves straight to Done', async () => {
    const { svc, getCaptured, getStored } = makeService({
      taskStatus: TaskStatus.IN_PROGRESS, payload: JSON.stringify({ laneKey: 'in_progress' }),
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'shipped [auto-approve]' });
    expect(getStored().status).toBe(TaskStatus.DONE);
    expect(getCaptured()).toBeNull();
  });

  it('does NOT chain on the RUNNING→in_progress move (the lane the current run already owns)', async () => {
    const { svc, getCaptured, getStored } = makeService({
      taskStatus: TaskStatus.TODO, payload: JSON.stringify({ laneKey: 'todo' }),
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.RUNNING });
    expect(getStored().status).toBe(TaskStatus.IN_PROGRESS);
    expect(getCaptured()).toBeNull();
  });

  it('advances to the board’s CONFIGURED next swimlane on COMPLETED (not hardcoded in_review)', async () => {
    const { svc, getStored, getCaptured } = makeService({
      taskStatus: 'build', payload: JSON.stringify({ laneKey: 'build' }), nextStatus: 'qa',
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'done' });
    expect(getStored().status).toBe('qa');
    expect(getCaptured()).toEqual({ status: 'qa', originLaneKey: 'build' });
  });

  it('falls back to in_review when the resolver returns null (non-board task)', async () => {
    const { svc, getStored } = makeService({
      taskStatus: TaskStatus.IN_PROGRESS, payload: null, nextStatus: null,
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'done' });
    expect(getStored().status).toBe(TaskStatus.IN_REVIEW);
  });

  it('[auto-approve] still short-circuits to Done even with a configured next lane', async () => {
    const { svc, getStored, getCaptured } = makeService({
      taskStatus: 'build', payload: JSON.stringify({ laneKey: 'build' }), nextStatus: 'qa',
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'shipped [auto-approve]' });
    expect(getStored().status).toBe(TaskStatus.DONE);
    expect(getCaptured()).toBeNull();
  });

  it('does NOT chain on a FAILED terminal (lane unchanged)', async () => {
    const { svc, getCaptured } = makeService({
      taskStatus: TaskStatus.IN_PROGRESS, payload: JSON.stringify({ laneKey: 'in_progress' }),
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.FAILED, errorMessage: 'boom' });
    expect(getCaptured()).toBeNull();
  });

  it('does not let RuntimeService move a managed ticket when the Coordinator keeps the stage blocked', async () => {
    const { svc, getStored, getCaptured } = makeService({
      taskStatus: 'ready', payload: JSON.stringify({ laneKey: 'ready', actAsRole: 'business-analyst' }), managedToStatus: 'ready',
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'requirements drafted' });
    expect(getStored().status).toBe('ready');
    expect(getCaptured()).toBeNull();
  });

  it('uses the Coordinator result without invoking legacy lane chaining', async () => {
    const { svc, getCaptured, getManagedRunStatusCalls } = makeService({
      taskStatus: 'ready', payload: JSON.stringify({ laneKey: 'ready', actAsRole: 'architect' }), managedToStatus: 'in_progress',
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'design approved' });
    // The composition-root Coordinator performs the DB move + next-role dispatch;
    // RuntimeService must not perform a second move/trigger.
    expect(getCaptured()).toBeNull();
    expect(getManagedRunStatusCalls()).toBe(1);
  });

  it('does not move a managed ticket to in_progress merely because its role run started', async () => {
    const { svc, getStored, getManagedRunStatusCalls } = makeService({
      taskStatus: 'ready', payload: JSON.stringify({ laneKey: 'ready', actAsRole: 'business-analyst' }), managedToStatus: 'ready',
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.RUNNING });
    expect(getStored().status).toBe('ready');
    expect(getManagedRunStatusCalls()).toBe(1);
  });

  it('retries a transient side-effect failure and still runs later lifecycle effects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { svc, getCaptured, getTaskSyncCalls } = makeService({
      taskStatus: TaskStatus.IN_PROGRESS,
      payload: JSON.stringify({ laneKey: 'in_progress' }),
      taskSyncFailures: 1,
    });

    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'done' });

    expect(getTaskSyncCalls()).toBe(2);
    expect(getCaptured()).toEqual({ status: TaskStatus.IN_REVIEW, originLaneKey: 'in_progress' });
    expect(errorSpy).toHaveBeenCalledWith(
      '[caught-error]',
      expect.objectContaining({
        source: 'application/runtime/RuntimeService.ts',
        operation: 'runEffect',
        context: expect.objectContaining({
          details: expect.objectContaining({
            effect: 'task_status_sync',
            attempt: 1,
            executionId: EXEC_ID,
          }),
        }),
      }),
    );
    errorSpy.mockRestore();
  });

  it('records a permanently failed effect without suppressing the remaining chain', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { svc, getCaptured, getTaskSyncCalls } = makeService({
      taskStatus: TaskStatus.IN_PROGRESS,
      payload: JSON.stringify({ laneKey: 'in_progress' }),
      taskSyncFailures: 99,
    });

    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'done' });

    expect(getTaskSyncCalls()).toBe(3);
    expect(getCaptured()).toEqual({ status: TaskStatus.IN_REVIEW, originLaneKey: 'in_progress' });
    errorSpy.mockRestore();
  });

  /**
   * THE OTHER HALF OF THE MANAGED OVERRIDE. A lifecycle-managed board now admits a run
   * that names no stage role when it carries a declared authority — a person directing
   * execution from a surface that cannot see the board type, or platform machinery that
   * performs no role. Letting those RUN is the point. Letting them ADVANCE the ticket
   * would be the hole: a managed stage may move only on a recorded verdict from a role
   * accountable for it, and an override that also skipped the sign-off gate would be a
   * bypass wearing an audit trail.
   *
   * The dispatcher stamps `lifecycleNeutral` at the single point that knows the board is
   * managed AND that the run carries no attribution, so these assertions are what make
   * the marker mean something rather than being inert metadata.
   */
  it('a lifecycle-neutral run does NOT advance the lane on completion', async () => {
    const { svc, getStored, getCaptured } = makeService({
      taskStatus: TaskStatus.IN_PROGRESS,
      payload: JSON.stringify({ laneKey: 'in_progress', lifecycleNeutral: true, runAuthority: { kind: 'human', by: 'u-1', reason: 'Run now.' } }),
    });

    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'deployed' });

    // The ticket is exactly where it was. Compare with the first test in this file,
    // whose identical run advances IN_PROGRESS → IN_REVIEW.
    expect(getStored().status).toBe(TaskStatus.IN_PROGRESS);
    // `null` is the harness's untouched initial value: onLaneEntry never fired.
    expect(getCaptured()).toBeNull();
  });

  it('a lifecycle-neutral run does not take the RUNNING→in_progress move either', async () => {
    // Holding the lane means holding it in both directions: a compile run must not drag
    // a ticket out of `todo` just by starting.
    const { svc, getStored } = makeService({
      taskStatus: TaskStatus.TODO,
      payload: JSON.stringify({ laneKey: 'todo', lifecycleNeutral: true, runAuthority: { kind: 'system', by: 'ci-autofix', reason: 'x' } }),
    });

    await svc.update(EXEC_ID, { status: ExecutionStatus.RUNNING });

    expect(getStored().status).toBe(TaskStatus.TODO);
  });

  it('does not hand a neutral run to the Coordinator — it has no role evidence to record', async () => {
    // Its terminal event could only trigger a stage transition it has no standing to
    // cause. A ROLE run still reaches the Coordinator; that is asserted above.
    const { svc, getManagedRunStatusCalls } = makeService({
      taskStatus: 'ready',
      payload: JSON.stringify({ laneKey: 'ready', lifecycleNeutral: true, runAuthority: { kind: 'system', by: 'security-audit', reason: 'x' } }),
      managedToStatus: 'in_progress',
    });

    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'audited' });

    expect(getManagedRunStatusCalls()).toBe(0);
  });

  it('retries lane dispatch with the same idempotent transition context', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { svc, getCaptured, getLaneEntryCalls } = makeService({
      taskStatus: TaskStatus.IN_PROGRESS,
      payload: JSON.stringify({ laneKey: 'in_progress' }),
      laneEntryFailures: 2,
    });

    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'done' });

    expect(getLaneEntryCalls()).toBe(3);
    expect(getCaptured()).toEqual({ status: TaskStatus.IN_REVIEW, originLaneKey: 'in_progress' });
    errorSpy.mockRestore();
  });
});
