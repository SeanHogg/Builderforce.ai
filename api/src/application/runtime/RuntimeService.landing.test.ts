/**
 * RuntimeService terminal transitions go through the repository's ONE conditional `land()`: the loser of a race skips every side
 * effect (cancel signal, audit, milestone, onTerminalFailure, lane sync), the winner runs them, and the run's final tally rides the
 * landing to the outcome owner.
 */
import { describe, expect, it, vi } from 'vitest';
import { RuntimeService } from './RuntimeService';
import { Execution } from '../../domain/execution/Execution';
import { Task } from '../../domain/task/Task';
import { ExecutionStatus, TaskPriority, TaskStatus, TaskType } from '../../domain/shared/types';
import type { IExecutionRepository } from '../../domain/execution/IExecutionRepository';
import type { ITaskRepository } from '../../domain/task/ITaskRepository';
import type { IAgentRepository } from '../../domain/agent/IAgentRepository';
import type { IAuditRepository } from '../../domain/audit/IAuditRepository';

const now = new Date();
const execution = (status = ExecutionStatus.RUNNING) => Execution.reconstitute({
  id: 7 as never, taskId: 3 as never, agentId: null, agentHostId: null, tenantId: 1 as never, submittedBy: 'u', sessionId: null, status,
  payload: null, cloudAgentRef: 'agent-dev', result: null, errorMessage: null, produced: null, startedAt: now, completedAt: null, createdAt: now, updatedAt: now,
});
const task = () => Task.reconstitute({
  id: 3 as never, projectId: 3 as never, key: 'P-1', title: 't', description: null, status: TaskStatus.IN_PROGRESS, priority: TaskPriority.MEDIUM, taskType: TaskType.TASK,
  parentTaskId: null, assignedAgentType: null, githubIssueNumber: null, githubIssueUrl: null, githubPrUrl: null, githubPrNumber: null, assignedAgentHostId: null,
  assignedAgentRef: null, assignedUserId: null, gitBranch: null, explicitRepoId: null, sprintId: null, releaseId: null, storyPoints: null, businessValue: null,
  businessValueRationale: null, businessValueSource: null, managerRank: null, reviewCount: 0, lastReviewedAt: null, lastReviewVerdict: null, gapOriginTaskId: null,
  startDate: null, dueDate: null, decompositionSource: null, persona: null, archived: false, createdAt: now, updatedAt: now,
});

/** `winner`: the row another writer already landed (the loser's land() returns it with won: false); absent => this writer wins. */
function build(winner?: Execution, opts: { staleWriteRefusedBy?: Execution } = {}) {
  const land = vi.fn(async (_id: unknown, status: string, f: { result?: string | null; errorMessage?: string | null } = {}, _from?: unknown, ctx?: unknown) => {
    if (winner) return { won: false, execution: winner };
    const e = execution();
    const landed = status === 'completed' ? e.markCompleted(f.result ?? '') : status === 'failed' ? e.markFailed(f.errorMessage ?? '') : e.cancel();
    return { won: true, execution: landed, ctx };
  });
  const audit = { save: vi.fn(async () => undefined) };
  const ports = {
    onCancelled: vi.fn(async () => undefined),
    onTerminalFailure: vi.fn(async () => undefined),
    onTaskStatusSync: vi.fn(async () => undefined),
    onManagedRunStatus: vi.fn(async () => ({ managed: false, toStatus: 'in_progress' })),
    resolveRunningStatus: vi.fn(async () => TaskStatus.IN_PROGRESS),
  };
  // A non-terminal write is guarded in SQL: when the run already landed, the repository refuses it and hands back the terminal row.
  const executions = { findById: async () => execution(), update: async (e: Execution) => opts.staleWriteRefusedBy ?? e, land, setProduced: async () => execution() } as unknown as IExecutionRepository;
  const tasks = { findById: async () => task(), update: async (t: Task) => t } as unknown as ITaskRepository;
  const svc = new RuntimeService({ executions, tasks, agents: {} as IAgentRepository, audit: audit as unknown as IAuditRepository, ...ports });
  return { svc, land, audit, ports };
}

describe('RuntimeService - the loser of a terminal race does nothing', () => {
  it('a cancel that lost to a completion fires no cancel signal and writes no audit', async () => {
    const { svc, audit, ports } = build(execution(ExecutionStatus.COMPLETED));
    const result = await svc.cancel(7, 'user-1');
    expect(result.status).toBe(ExecutionStatus.COMPLETED); // the winner's row stands
    expect(ports.onCancelled).not.toHaveBeenCalled();
    expect(audit.save).not.toHaveBeenCalled();
  });

  it('a cancel that wins signals the runner and audits', async () => {
    const { svc, audit, ports } = build();
    const result = await svc.cancel(7, 'user-1');
    expect(result.status).toBe(ExecutionStatus.CANCELLED);
    expect(ports.onCancelled).toHaveBeenCalledTimes(1);
    expect(audit.save).toHaveBeenCalledTimes(1);
  });

  it('update(COMPLETED) that lost returns the winner and skips the task lifecycle sync', async () => {
    const { svc, ports } = build(execution(ExecutionStatus.FAILED));
    const result = await svc.update(7, { status: ExecutionStatus.COMPLETED, result: 'done' });
    expect(result.status).toBe(ExecutionStatus.FAILED);
    expect(ports.onTaskStatusSync).not.toHaveBeenCalled();
  });

  it('update(COMPLETED) lands through land() and hands the run\'s final tally to the outcome owner', async () => {
    const { svc, land } = build();
    const telemetry = { toolCalls: 4 };
    const result = await svc.update(7, { status: ExecutionStatus.COMPLETED, result: 'done', telemetry: telemetry as never });
    expect(result.status).toBe(ExecutionStatus.COMPLETED);
    expect(land).toHaveBeenCalledWith(expect.anything(), 'completed', expect.objectContaining({ result: 'done' }), undefined, { telemetry });
  });

  it("a steered stop's cancel carries the run's final tally to the outcome owner", async () => {
    const { svc, land } = build();
    const telemetry = { toolCalls: 9 };
    await svc.cancel(7, 'user-1', { telemetry: telemetry as never });
    expect(land).toHaveBeenCalledWith(expect.anything(), 'cancelled', expect.anything(), undefined, { telemetry });
  });

  it('a cancel with no tally (an external cancel) lands with none: the row carries no counts', async () => {
    const { svc, land } = build();
    await svc.cancel(7, 'user-1');
    expect(land).toHaveBeenCalledWith(expect.anything(), 'cancelled', expect.anything(), undefined, { telemetry: undefined });
  });

  it('update(RUNNING) refused because the run was cancelled meanwhile (the cloudPrepare race): returns the cancelled row, no lane move, no audit, no managed-lane callback', async () => {
    const { svc, audit, ports } = build(undefined, { staleWriteRefusedBy: execution(ExecutionStatus.CANCELLED) });
    const result = await svc.update(7, { status: ExecutionStatus.RUNNING });
    expect(result.status).toBe(ExecutionStatus.CANCELLED);
    expect(ports.onManagedRunStatus).not.toHaveBeenCalled();
    expect(ports.resolveRunningStatus).not.toHaveBeenCalled();
    expect(ports.onTaskStatusSync).not.toHaveBeenCalled();
    expect(audit.save).not.toHaveBeenCalled(); // no EXECUTION_STARTED for a run that never started
  });

  it('update(RUNNING) that applies still starts the run: audit written', async () => {
    const { svc, audit } = build();
    const result = await svc.update(7, { status: ExecutionStatus.RUNNING });
    expect(result.status).toBe(ExecutionStatus.RUNNING);
    expect(audit.save).toHaveBeenCalledTimes(1);
  });
});
