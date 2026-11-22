/**
 * Regression: a run that finishes with outcome `no_changes` (MK-09-W5 — nothing written,
 * not cancelled) is owed EXACTLY the post-run bookkeeping a COMPLETED run gets, through the
 * ONE shared fan-out (`applyLandedLifecycle` + `recordLandedAudit`): the ticket's lane move,
 * the metrics sync, the next-lane trigger, the chat milestone and the audit entry — and its
 * outcome row carries EXPLICIT zero counts, never null/missing.
 *
 * Before the fix, `RuntimeService.update` rejected the NO_CHANGES status outright
 * (ForbiddenError, swallowed as a warning by CloudRunnerDO), so every one of those steps
 * was silently skipped and the telemetry counts stayed null.
 */
import { describe, expect, it, vi } from 'vitest';
import { RuntimeService } from './RuntimeService';
import { Execution } from '../../domain/execution/Execution';
import { Task } from '../../domain/task/Task';
import { AuditEventType, ExecutionStatus, TaskPriority, TaskStatus, TaskType } from '../../domain/shared/types';
import type { IExecutionRepository } from '../../domain/execution/IExecutionRepository';
import type { ITaskRepository } from '../../domain/task/ITaskRepository';
import type { IAuditRepository } from '../../domain/audit/IAuditRepository';
import { applyLandedLifecycle, recordLandedAudit, type LandedEffectDeps, type LandedRun } from './executionLandedEffects';

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

function build() {
  const land = vi.fn(async (_id: unknown, status: string, f: { result?: string | null; errorMessage?: string | null } = {}, _from?: unknown, ctx?: unknown) => {
    const e = execution();
    const landed = status === ExecutionStatus.NO_CHANGES ? e.markNoChanges(f.result ?? '')
      : status === ExecutionStatus.COMPLETED ? e.markCompleted(f.result ?? '')
      : e.markFailed(f.errorMessage ?? '');
    return { won: true, execution: landed, ctx };
  });
  const setProduced = vi.fn(async () => execution());
  const audit = { save: vi.fn(async (_event: unknown) => undefined) };
  const taskUpdate = vi.fn(async (t: Task) => t);
  const ports = {
    onTaskStatusSync: vi.fn(async () => undefined),
    onRunMilestone: vi.fn(async () => undefined),
    onRunFinalized: vi.fn(async () => undefined),
    onManagedRunStatus: vi.fn(async () => ({ managed: false, toStatus: TaskStatus.IN_PROGRESS })),
    onLaneEntry: vi.fn(async () => undefined),
    resolveNextStatus: vi.fn(async () => TaskStatus.IN_REVIEW),
  };
  const executions = { findById: async () => execution(), update: async (e: Execution) => e, land, setProduced } as unknown as IExecutionRepository;
  const tasks = { findById: async () => task(), update: taskUpdate } as unknown as ITaskRepository;
  const svc = new RuntimeService({ executions, tasks, audit: audit as unknown as IAuditRepository, ...ports });
  return { svc, land, setProduced, audit, ports, taskUpdate };
}

describe('RuntimeService.update(NO_CHANGES) — the same bookkeeping a COMPLETED run gets', () => {
  it('lands the run terminal with its result, through the ONE land() writer', async () => {
    const { svc, land } = build();
    const result = await svc.update(7, { status: ExecutionStatus.NO_CHANGES, result: 'nothing to change' });
    expect(result.status).toBe(ExecutionStatus.NO_CHANGES);
    expect(result.isTerminal).toBe(true);
    expect(land).toHaveBeenCalledWith(expect.anything(), ExecutionStatus.NO_CHANGES, expect.objectContaining({ result: 'nothing to change' }), undefined, expect.anything());
  });

  it('moves the ticket lane, records metrics, triggers the next lane, narrates and audits', async () => {
    const { svc, ports, taskUpdate, audit } = build();
    await svc.update(7, { status: ExecutionStatus.NO_CHANGES, result: 'nothing to change' });

    // Lane move: the board's next lane, exactly like a COMPLETED run.
    expect(taskUpdate).toHaveBeenCalledTimes(1);
    expect(taskUpdate.mock.calls[0]![0].toPlain().status).toBe(TaskStatus.IN_REVIEW);
    // Metrics: the terminal work-stopped signal, with the from/to lanes.
    expect(ports.onTaskStatusSync).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 3, projectId: 3, fromStatus: TaskStatus.IN_PROGRESS, toStatus: TaskStatus.IN_REVIEW, terminal: true, actorAgentRef: 'agent-dev',
    }));
    // Next-lane trigger: the same auto-run dispatch a COMPLETED lane advance fires.
    expect(ports.onLaneEntry).toHaveBeenCalledWith(expect.objectContaining({ taskId: 3, status: TaskStatus.IN_REVIEW }));
    // Managed callback + manifest attribution read it as a completed run.
    expect(ports.onManagedRunStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', taskId: 3 }));
    expect(ports.onRunFinalized).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', executionId: 7 }));
    // Chat milestone: the people on the ticket hear the run finished.
    expect(ports.onRunMilestone).toHaveBeenCalledWith(expect.objectContaining({ phase: 'completed', executionId: 7, resultText: 'nothing to change' }));
    // Audit entry: a completion, with the empty-diff fact explicit.
    expect(audit.save).toHaveBeenCalledTimes(1);
    const event = audit.save.mock.calls[0]![0] as { eventType: AuditEventType; metadata: string | null };
    expect(event.eventType).toBe(AuditEventType.EXECUTION_COMPLETED);
    expect(JSON.parse(event.metadata ?? '{}')).toEqual(expect.objectContaining({ noChanges: true }));
  });

  it('writes EXPLICIT zero counts when the lander handed no tally — never null/missing', async () => {
    const { svc, land } = build();
    await svc.update(7, { status: ExecutionStatus.NO_CHANGES, result: 'nothing to change' });
    const ctx = land.mock.calls[0]![4] as { telemetry?: Record<string, unknown> };
    expect(ctx.telemetry).toEqual(expect.objectContaining({
      toolCalls: 0, toolErrors: 0, tokens: 0, cacheReadTokens: 0, shellFileReads: 0, repoErrors: 0, mutations: 0,
    }));
  });

  it("a real tally is never overwritten by the zeros", async () => {
    const { svc, land } = build();
    const telemetry = { toolCalls: 4, toolErrors: 0, tokens: 120, cacheReadTokens: 0, shellFileReads: 1, repoErrors: 0, mutations: 0, costLatch: true as const };
    await svc.update(7, { status: ExecutionStatus.NO_CHANGES, result: 'investigated only', telemetry });
    expect(land).toHaveBeenCalledWith(expect.anything(), ExecutionStatus.NO_CHANGES, expect.anything(), undefined, { telemetry });
  });

  it('a lane advance stamps produced — the move IS the no-code run\'s product', async () => {
    const { svc, setProduced } = build();
    const saved = await svc.update(7, { status: ExecutionStatus.NO_CHANGES, result: 'nothing to change' });
    expect(setProduced).toHaveBeenCalledTimes(1);
    expect(saved.produced).toBe(true);
  });

  it('COMPLETED behaviour is unchanged: same lane move, and no zero-tally stand-in', async () => {
    const { svc, land, ports, taskUpdate, audit } = build();
    const saved = await svc.update(7, { status: ExecutionStatus.COMPLETED, result: 'done' });
    expect(saved.status).toBe(ExecutionStatus.COMPLETED);
    expect(taskUpdate).toHaveBeenCalledTimes(1);
    expect(ports.onLaneEntry).toHaveBeenCalledTimes(1);
    expect(audit.save).toHaveBeenCalledTimes(1);
    const event = audit.save.mock.calls[0]![0] as { eventType: AuditEventType; metadata: string | null };
    expect(event.eventType).toBe(AuditEventType.EXECUTION_COMPLETED);
    expect(JSON.parse(event.metadata ?? '{}').noChanges).toBeUndefined();
    // A COMPLETED run without a tally still lands with none (only no_changes owes explicit zeros).
    expect(land).toHaveBeenCalledWith(expect.anything(), ExecutionStatus.COMPLETED, expect.anything(), undefined, { telemetry: undefined });
  });
});

describe('applyLandedLifecycle(NO_CHANGES) — the shared fan-out itself', () => {
  const run = (over: Partial<LandedRun> = {}): LandedRun => ({
    id: 42, tenantId: 1, taskId: 7, payload: null, cloudAgentRef: 'agent-x', agentHostId: null, ...over,
  });
  function makeDeps() {
    const t = {
      status: 'in_progress',
      toPlain: () => ({ id: 7, projectId: 3, taskType: 'task', tenantId: 1 }),
      update: vi.fn(),
    };
    const ports = {
      onTaskStatusSync: vi.fn(async () => undefined),
      onRunMilestone: vi.fn(async () => undefined),
      onRunFinalized: vi.fn(async () => undefined),
      onManagedRunStatus: vi.fn(async (info: { fromStatus: string }) => ({ managed: false, toStatus: info.fromStatus })),
      onLaneEntry: vi.fn(async () => undefined),
    };
    const audit = { save: vi.fn(async (_event: unknown) => undefined) };
    const tasks = { findById: vi.fn(async () => t), update: vi.fn(async () => t) };
    const deps = { tasks, audit, ports } as unknown as LandedEffectDeps;
    return { deps, ports, audit, tasks };
  }

  it('a no_changes outcome advances the lane and chains the next lane, exactly like COMPLETED', async () => {
    const { deps, ports, tasks } = makeDeps();
    const res = await applyLandedLifecycle(deps, run(), { status: ExecutionStatus.NO_CHANGES, result: 'empty' });
    expect(res.movedTicket).toBe(true);
    expect(tasks.update).toHaveBeenCalledTimes(1);
    expect(ports.onTaskStatusSync).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, toStatus: TaskStatus.IN_REVIEW }));
    expect(ports.onLaneEntry).toHaveBeenCalledWith(expect.objectContaining({ status: TaskStatus.IN_REVIEW }));
    expect(ports.onRunMilestone).toHaveBeenCalledWith(expect.objectContaining({ phase: 'completed', executionId: 42 }));
  });

  it('a lane-holding run (validator review) still holds its lane on no_changes', async () => {
    const { deps, ports } = makeDeps();
    const res = await applyLandedLifecycle(
      deps,
      run({ payload: JSON.stringify({ validatorReview: true }) }),
      { status: ExecutionStatus.NO_CHANGES, result: 'verdict' },
    );
    expect(res.movedTicket).toBe(false);
    expect(ports.onLaneEntry).not.toHaveBeenCalled();
    expect(ports.onTaskStatusSync).toHaveBeenCalledWith(expect.objectContaining({ terminal: true, fromStatus: 'in_progress', toStatus: 'in_progress' }));
  });

  it('recordLandedAudit writes the completion audit with noChanges:true, keeping the writer metadata', async () => {
    const { audit } = makeDeps();
    await recordLandedAudit(audit as unknown as IAuditRepository, run(), ExecutionStatus.NO_CHANGES, JSON.stringify({ result: 'empty' }));
    expect(audit.save).toHaveBeenCalledTimes(1);
    const event = audit.save.mock.calls[0]![0] as { eventType: AuditEventType; metadata: string | null };
    expect(event.eventType).toBe(AuditEventType.EXECUTION_COMPLETED);
    expect(JSON.parse(event.metadata ?? '{}')).toEqual({ result: 'empty', noChanges: true });
  });
});
