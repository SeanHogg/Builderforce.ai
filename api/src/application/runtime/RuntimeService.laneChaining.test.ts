import { describe, it, expect } from 'vitest';
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
    gitBranch: null, explicitRepoId: null, sprintId: null, releaseId: null, storyPoints: null, startDate: null, dueDate: null,
    persona: null, archived: false, createdAt: now, updatedAt: now,
  });
}

function buildExecution(payload: string | null, status = ExecutionStatus.RUNNING): Execution {
  const now = new Date();
  return Execution.reconstitute({
    id: EXEC_ID as never, taskId: TASK_ID as never, agentId: null, agentHostId: null,
    tenantId: 1 as never, submittedBy: 'system:lane-auto', sessionId: null, status,
    payload, cloudAgentRef: 'agent-dev', result: null, errorMessage: null,
    startedAt: now, completedAt: null, createdAt: now, updatedAt: now,
  });
}

type Captured = { status: string; originLaneKey?: string } | null;

function makeService(opts: { taskStatus: string; payload: string | null; nextStatus?: string | null }) {
  let stored = buildTask(opts.taskStatus);
  const exec = buildExecution(opts.payload);
  const executions = {
    findById: async () => exec,
    update: async (e: Execution) => e,
  } as unknown as IExecutionRepository;
  const tasks = {
    findById: async () => stored,
    update: async (t: Task) => { stored = t; return t; },
  } as unknown as ITaskRepository;
  const agents = {} as IAgentRepository;
  const audit = { save: async () => undefined } as unknown as IAuditRepository;

  let captured: Captured = null;
  const onLaneEntry = async (info: { status: string; originLaneKey?: string }) => {
    captured = { status: info.status, originLaneKey: info.originLaneKey };
  };
  // When a nextStatus is provided the service is wired WITH the config-driven
  // resolver (mimicking the board having a next swimlane); otherwise it is left
  // undefined so the default in_review path is exercised.
  const resolveNextStatus = opts.nextStatus !== undefined
    ? async () => opts.nextStatus ?? null
    : undefined;
  const svc = new RuntimeService(executions, tasks, agents, audit, undefined, undefined, undefined, onLaneEntry, resolveNextStatus);
  return { svc, getCaptured: () => captured, getStored: () => stored };
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
});
