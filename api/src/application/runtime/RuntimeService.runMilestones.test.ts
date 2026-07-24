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
 * Run-milestone narration — the "human driving the chat is notified on execution"
 * contract at the RuntimeService seam. Every lifecycle transition MUST invoke
 * `onRunMilestone` (wired at the composition root to ChatTicketService.postRunMilestone,
 * which lands a message in every linked Brain chat + broadcasts the DO `changed` frame
 * both the web and VSIX Brain re-read on):
 *
 *   • started    — on EVERY RUNNING transition (previously gated on the task lane
 *                  flipping to in_progress, so re-runs and Coordinator-managed lanes
 *                  started silently — the fixed gap).
 *   • completed  — with the destination lane + result first-line.
 *   • failed     — with the error reason; ALSO posted by the read-path orphan reaper
 *                  (reapIfOrphaned), which previously failed a run without a word.
 *   • paused / resumed / cancelled — via postLifecycleMilestone(-ById) from the
 *                  direct-write sites, carrying the ask_human question + approval nonce.
 */

const TASK_ID = 7;
const EXEC_ID = 42;

function buildTask(status: string, taskType: string = TaskType.TASK): Task {
  const now = new Date();
  return Task.reconstitute({
    id: TASK_ID as never, projectId: 3 as never, key: 'P-001', title: 't', description: null,
    status, priority: TaskPriority.MEDIUM, taskType: taskType as never, parentTaskId: null,
    assignedAgentType: null, githubIssueNumber: null, githubIssueUrl: null, githubPrUrl: null,
    githubPrNumber: null, assignedAgentHostId: null, assignedAgentRef: null, assignedUserId: null,
    gitBranch: null, explicitRepoId: null, sprintId: null, releaseId: null, storyPoints: null,
    businessValue: null, businessValueRationale: null, businessValueSource: null, managerRank: null,
    reviewCount: 0, lastReviewedAt: null, lastReviewVerdict: null, gapOriginTaskId: null,
    startDate: null, dueDate: null,
    persona: null, archived: false, createdAt: now, updatedAt: now,
  });
}

function buildExecution(opts: {
  payload?: string | null; status?: ExecutionStatus; startedAt?: Date; updatedAt?: Date;
} = {}): Execution {
  const now = new Date();
  return Execution.reconstitute({
    id: EXEC_ID as never, taskId: TASK_ID as never, agentId: null, agentHostId: null,
    tenantId: 1 as never, submittedBy: 'user-1', sessionId: null,
    status: opts.status ?? ExecutionStatus.RUNNING,
    payload: opts.payload ?? null, cloudAgentRef: 'agent-dev', result: null, errorMessage: null,
    startedAt: opts.startedAt ?? now, completedAt: null, createdAt: opts.startedAt ?? now,
    updatedAt: opts.updatedAt ?? now,
  });
}

interface MilestoneCall {
  phase: string; taskType: string; executionId: number; tenantId: number; taskId: number;
  toStatus?: string | null; resultText?: string | null; errorMessage?: string | null;
  questionText?: string | null; eventNonce?: string | null;
}

function makeService(opts: {
  taskStatus?: string; taskType?: string; payload?: string | null;
  execution?: Execution; managedToStatus?: string;
} = {}) {
  const stored = buildTask(opts.taskStatus ?? TaskStatus.IN_PROGRESS, opts.taskType);
  const exec = opts.execution ?? buildExecution({ payload: opts.payload ?? null });
  let savedExec: Execution | null = null;
  const executions = {
    findById: async () => exec,
    update: async (e: Execution) => { savedExec = e; return e; },
  } as unknown as IExecutionRepository;
  const tasks = {
    findById: async () => stored,
    update: async (t: Task) => t,
  } as unknown as ITaskRepository;
  const agents = {} as IAgentRepository;
  const audit = { save: async () => undefined } as unknown as IAuditRepository;

  const milestones: MilestoneCall[] = [];
  const onRunMilestone = async (info: MilestoneCall) => { milestones.push(info); };
  const onManagedRunStatus = opts.managedToStatus !== undefined
    ? async () => ({ managed: true, toStatus: opts.managedToStatus! })
    : undefined;
  const svc = new RuntimeService(
    executions, tasks, agents, audit,
    undefined, undefined, undefined, undefined, undefined,
    onRunMilestone as never, undefined, onManagedRunStatus,
  );
  return { svc, milestones, getSavedExec: () => savedExec };
}

describe('RuntimeService run-milestone narration (chat awareness)', () => {
  it('narrates `started` even when the ticket is ALREADY in_progress (re-run — the silent-start gap)', async () => {
    const { svc, milestones } = makeService({ taskStatus: TaskStatus.IN_PROGRESS });
    await svc.update(EXEC_ID, { status: ExecutionStatus.RUNNING });
    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({ phase: 'started', executionId: EXEC_ID, tenantId: 1, taskId: TASK_ID });
  });

  it('narrates `started` on a Coordinator-managed board where the lane does not move (was silent)', async () => {
    const { svc, milestones } = makeService({
      taskStatus: 'ready', payload: JSON.stringify({ laneKey: 'ready', actAsRole: 'developer' }),
      managedToStatus: 'ready',
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.RUNNING });
    expect(milestones.map((m) => m.phase)).toEqual(['started']);
  });

  it('narrates `completed` with the destination lane and the result text', async () => {
    const { svc, milestones } = makeService({ taskStatus: TaskStatus.IN_PROGRESS });
    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'Shipped the fix' });
    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({
      phase: 'completed', toStatus: TaskStatus.IN_REVIEW, resultText: 'Shipped the fix',
    });
  });

  it('narrates `failed` with the error reason', async () => {
    const { svc, milestones } = makeService({ taskStatus: TaskStatus.IN_PROGRESS });
    await svc.update(EXEC_ID, { status: ExecutionStatus.FAILED, errorMessage: 'LLM budget exhausted' });
    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({ phase: 'failed', errorMessage: 'LLM budget exhausted' });
  });

  it('normalizes the chat-ticket kind: epics and gaps keep their kind, everything else is task', async () => {
    const epic = makeService({ taskStatus: TaskStatus.IN_PROGRESS, taskType: 'epic' });
    await epic.svc.update(EXEC_ID, { status: ExecutionStatus.RUNNING });
    expect(epic.milestones[0]!.taskType).toBe('epic');

    const story = makeService({ taskStatus: TaskStatus.IN_PROGRESS, taskType: 'story' });
    await story.svc.update(EXEC_ID, { status: ExecutionStatus.RUNNING });
    expect(story.milestones[0]!.taskType).toBe('task');
  });

  it('stays SILENT for an internal Validator review run (no chat noise)', async () => {
    const { svc, milestones } = makeService({
      taskStatus: TaskStatus.DONE, payload: JSON.stringify({ validatorReview: true }),
    });
    await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'review verdict' });
    expect(milestones).toHaveLength(0);
  });

  it('narrates `cancelled` from cancel() (a direct write that bypasses update())', async () => {
    const { svc, milestones } = makeService({ taskStatus: TaskStatus.IN_PROGRESS });
    await svc.cancel(EXEC_ID, 'user-1');
    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({ phase: 'cancelled', executionId: EXEC_ID });
  });

  it('narrates `failed` when the read-path orphan reaper kills a silent run (was a silent death)', async () => {
    const staleSince = new Date(Date.now() - 24 * 60 * 60_000);
    const { svc, milestones, getSavedExec } = makeService({
      taskStatus: TaskStatus.IN_PROGRESS,
      execution: buildExecution({ status: ExecutionStatus.RUNNING, startedAt: staleSince, updatedAt: staleSince }),
    });
    await svc.getExecution(EXEC_ID);
    expect(getSavedExec()?.status).toBe(ExecutionStatus.FAILED);
    expect(milestones).toHaveLength(1);
    expect(milestones[0]!.phase).toBe('failed');
    expect(milestones[0]!.errorMessage).toBeTruthy();
  });

  it('postLifecycleMilestoneById threads the ask_human question + approval nonce for `paused`', async () => {
    const { svc, milestones } = makeService({ taskStatus: TaskStatus.IN_PROGRESS });
    await svc.postLifecycleMilestoneById(EXEC_ID, 'paused', {
      questionText: 'Which database should I target?', eventNonce: 'appr-123',
    });
    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({
      phase: 'paused', questionText: 'Which database should I target?', eventNonce: 'appr-123',
    });
  });

  it('postLifecycleMilestoneById narrates `resumed` keyed by the answered approval', async () => {
    const { svc, milestones } = makeService({ taskStatus: TaskStatus.IN_PROGRESS });
    await svc.postLifecycleMilestoneById(EXEC_ID, 'resumed', { eventNonce: 'appr-123' });
    expect(milestones).toHaveLength(1);
    expect(milestones[0]).toMatchObject({ phase: 'resumed', eventNonce: 'appr-123' });
  });

  it('milestone failures never break the transition (best-effort contract)', async () => {
    const stored = buildTask(TaskStatus.IN_PROGRESS);
    const exec = buildExecution({});
    const svc = new RuntimeService(
      { findById: async () => exec, update: async (e: Execution) => e } as unknown as IExecutionRepository,
      { findById: async () => stored, update: async (t: Task) => t } as unknown as ITaskRepository,
      {} as IAgentRepository,
      { save: async () => undefined } as unknown as IAuditRepository,
      undefined, undefined, undefined, undefined, undefined,
      (async () => { throw new Error('chat down'); }) as never,
    );
    const saved = await svc.update(EXEC_ID, { status: ExecutionStatus.COMPLETED, result: 'done' });
    expect(saved.status).toBe(ExecutionStatus.COMPLETED);
  });
});
