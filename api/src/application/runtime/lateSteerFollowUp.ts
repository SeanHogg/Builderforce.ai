/**
 * LATE STEERS — a steer that lands after its run's last turn starts a follow-up run.
 *
 * Operator decision 2026-09-12: "steers that arrive after a run's last turn => spend the
 * tokens." Every surface has a window in which a steer can no longer reach the run it was
 * sent to:
 *   - the on-prem SDK runner closes its input stream the moment a turn returns with
 *     nothing queued, so the relay is refused (`run_finishing`), or the host no longer
 *     holds the run at all (`no_live_run`);
 *   - a cloud loop (durable / container / GitHub Actions) drains pending steers at the top
 *     of each step, so one posted after its final step is never read (`run_ended`);
 *   - a self-hosted run's terminal callback lands with a steer still undelivered.
 * Each of those used to mark the steer consumed and drop it. They all route HERE now, to
 * one use case that starts a follow-up on the same agent, repo pin and ticket branch —
 * through {@link startFollowUpRun}, the same machinery "Send" on a finished run and
 * `chats.execute_as_agent` use — with the steer as the directive, submitted under the
 * person who sent it.
 *
 * Guarantees:
 *   - IDEMPOTENT on the steer's row id: the claim is one atomic UPDATE, so a retried frame
 *     or a second terminal chokepoint finds the steer already claimed and starts nothing.
 *   - NEVER EARLY: while the run is still live the steer goes back to the pending queue
 *     (the live loop drains it, or the terminal chokepoint claims it) — a follow-up is
 *     never started beside the run it follows.
 *   - ENTITLEMENTS STAND: a follow-up refused for the token allowance or the cloud-run cap
 *     falls back to the visible drop (`steer.dropped`), carrying the refusal.
 *   - A CANCELLED run's steer is released, visibly: the person stopped the work.
 *   - Always ON THE TIMELINE: `steer.followed_up` names the run it started; `steer.dropped`
 *     (the pre-decision row, same shape, still readable) names why none started.
 */
import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { executions, projects, tasks } from '../../infrastructure/database/schema';
import { ExecutionStatus } from '../../domain/shared/types';
import type { RuntimeService } from './RuntimeService';
import { isTerminalExecutionStatus, parseCloudAgentRef } from './cloudDispatch';
import { startFollowUpRun, type FollowUpPriorRun, type FollowUpRunArgs, type FollowUpRunOutcome } from './followUpRun';
import type { ExecutionTaskRow } from './dispatchCloudRun';
import { recordCloudToolEvent } from './cloudToolEvents';
import { resolveCloudAgent } from './cloudAgent/agent';
import { claimLateSteers, lateSteerOutcomeOf, recordLateSteerOutcome, repend, type ClaimedSteer } from './lateSteerStore';
import type { LateSteerOutcomeKind } from './executionSteering';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** Why the steer missed its run. */
export type LateSteerReason = 'run_finishing' | 'no_live_run' | 'run_ended';
export const LATE_STEER_REASONS: readonly LateSteerReason[] = ['run_finishing', 'no_live_run', 'run_ended'];

/** Timeline tool names. `steer.dropped` predates the decision; its rows stay readable. */
export const STEER_FOLLOWED_UP_EVENT = 'steer.followed_up';
export const STEER_DROPPED_EVENT = 'steer.dropped';

export interface LateSteerExecution extends FollowUpPriorRun {
  tenantId: number;
  status: string;
  taskId: number;
  cloudAgentRef: string | null;
  submittedBy: string;
}

export type LateSteerOutcome =
  | { kind: 'none' }
  | { kind: 'deferred' }
  | { kind: 'released'; count: number }
  | { kind: 'duplicate'; outcome: LateSteerOutcomeKind | null; followUpExecutionId: number | null }
  | { kind: 'started'; followUpExecutionId: number }
  | { kind: 'awaiting_approval'; approvalId: string }
  | { kind: 'refused'; reason: string; message: string }
  | { kind: 'failed'; message: string };

/** What the use case needs from the world — injectable so the orchestration is testable. */
export interface LateSteerPorts {
  loadExecution(executionId: number, tenantId?: number): Promise<LateSteerExecution | null>;
  loadTask(tenantId: number, taskId: number): Promise<ExecutionTaskRow | null>;
  repend(executionId: number, messageIds: readonly number[]): Promise<void>;
  claim(executionId: number, messageIds?: readonly number[]): Promise<ClaimedSteer[]>;
  priorOutcome(executionId: number, messageIds: readonly number[]): Promise<{ outcome: LateSteerOutcomeKind | null; followUpExecutionId: number | null } | null>;
  recordOutcome(messageIds: readonly number[], outcome: { outcome: LateSteerOutcomeKind; followUpExecutionId?: number | null; detail?: string | null }): Promise<void>;
  agentLabel(tenantId: number, agentRef: string | undefined): Promise<string>;
  startFollowUp(args: FollowUpRunArgs): Promise<FollowUpRunOutcome>;
  timeline(event: {
    tenantId: number; executionId: number; agentHostId: number | null; cloudAgentRef?: string;
    toolName: string; detail: Record<string, unknown>; result: string;
  }): Promise<void>;
}

/**
 * Turn late steers into a follow-up run.
 *
 * `messageIds` given: a runtime reported exactly these steers as undelivered. Omitted:
 * a terminal chokepoint — every steer still pending on the run is late.
 */
export async function dispatchLateSteerFollowUp(
  ports: LateSteerPorts,
  input: { executionId: number; tenantId?: number; messageIds?: readonly number[]; reason: LateSteerReason },
): Promise<LateSteerOutcome> {
  const ids = input.messageIds && input.messageIds.length > 0 ? [...new Set(input.messageIds)] : undefined;
  let run = await ports.loadExecution(input.executionId, input.tenantId);
  if (!run) return { kind: 'none' };

  if (!isTerminalExecutionStatus(run.status)) {
    // Still live: the steer is not late for THIS run yet. Put it back in the queue the
    // live loop drains (or the terminal chokepoint claims), then re-read — the run may
    // have settled between the report and the re-queue, and nobody else would see it.
    if (!ids) return { kind: 'deferred' };
    await ports.repend(run.id, ids);
    run = await ports.loadExecution(input.executionId, input.tenantId);
    if (!run || !isTerminalExecutionStatus(run.status)) return { kind: 'deferred' };
  }
  const settled = run;

  const claimed = await ports.claim(settled.id, ids);
  if (claimed.length === 0) {
    if (!ids) return { kind: 'none' };
    // A retried frame, or a second chokepoint: already handled — say how, start nothing.
    const prior = await ports.priorOutcome(settled.id, ids);
    return { kind: 'duplicate', outcome: prior?.outcome ?? null, followUpExecutionId: prior?.followUpExecutionId ?? null };
  }

  const claimedIds = claimed.map((s) => s.id);
  const directive = claimed.map((s) => s.text).join('\n\n');
  const agentRef = settled.cloudAgentRef ?? parseCloudAgentRef(settled.payload ?? undefined) ?? undefined;
  const event = (toolName: string, detail: Record<string, unknown>, result: string) => ports.timeline({
    tenantId: settled.tenantId,
    executionId: settled.id,
    agentHostId: settled.agentHostId,
    ...(agentRef ? { cloudAgentRef: agentRef } : {}),
    toolName,
    // `text` + `reason` keep the pre-decision `steer.dropped` shape, so one reader serves both.
    detail: { text: directive, arrival: input.reason, messageIds: claimedIds, ...detail },
    result,
  });
  const drop = async (outcome: LateSteerOutcomeKind, reason: string, detail: string, extra: Record<string, unknown> = {}): Promise<void> => {
    await ports.recordOutcome(claimedIds, { outcome, detail });
    await event(STEER_DROPPED_EVENT, { reason, ...extra }, detail);
  };

  if (settled.status === ExecutionStatus.CANCELLED) {
    await drop('released', 'run_cancelled', 'The run was cancelled before this message could be delivered, so no follow-up run was started.');
    return { kind: 'released', count: claimed.length };
  }

  const task = await ports.loadTask(settled.tenantId, settled.taskId);
  if (!task) {
    const message = 'This message arrived after the run finished, but its ticket no longer exists, so no follow-up run was started.';
    await drop('failed', 'task_not_found', message);
    return { kind: 'failed', message };
  }

  // The person who sent the steer is the authority for the follow-up; a steer persisted
  // before `sent_by` existed falls back to whoever submitted the run it followed.
  const submittedBy = claimed.find((s) => s.sentBy)?.sentBy ?? settled.submittedBy;
  let outcome: FollowUpRunOutcome;
  try {
    outcome = await ports.startFollowUp({
      tenantId: settled.tenantId,
      prior: settled,
      taskRow: task,
      directive,
      submittedBy,
      agentLabel: await ports.agentLabel(settled.tenantId, agentRef ?? task.assignedAgentRef ?? undefined),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await drop('failed', 'dispatch_error', `This message arrived after the run finished, but the follow-up run could not be started: ${message}`, { error: message });
    return { kind: 'failed', message };
  }

  switch (outcome.kind) {
    case 'started':
      await ports.recordOutcome(claimedIds, { outcome: 'started', followUpExecutionId: outcome.executionId });
      await event(STEER_FOLLOWED_UP_EVENT, { outcome: 'started', followUpExecutionId: outcome.executionId, submittedBy },
        `This message arrived after the run's last turn, so it started follow-up run #${outcome.executionId} on the same branch.`);
      return { kind: 'started', followUpExecutionId: outcome.executionId };
    case 'awaiting_approval':
      await ports.recordOutcome(claimedIds, { outcome: 'awaiting_approval', detail: outcome.reason });
      await event(STEER_FOLLOWED_UP_EVENT, { outcome: 'awaiting_approval', approvalId: outcome.approvalId, submittedBy },
        `This message arrived after the run's last turn; its follow-up run is waiting for manager approval (${outcome.reason}).`);
      return { kind: 'awaiting_approval', approvalId: outcome.approvalId };
    case 'refused':
      await drop('refused', outcome.reason, `This message arrived after the run's last turn, but no follow-up run was started: ${outcome.message}`, { refusal: outcome.message });
      return { kind: 'refused', reason: outcome.reason, message: outcome.message };
  }
}

/** The terminal chokepoint's entry: every steer still pending on a settled run is late. */
export function settleLateSteers(ports: LateSteerPorts, args: { executionId: number; tenantId?: number }): Promise<LateSteerOutcome> {
  return dispatchLateSteerFollowUp(ports, { ...args, reason: 'run_ended' });
}

export interface LateSteerDeps {
  env: Env;
  db: Db;
  /** Reused when the caller already holds one; built lazily otherwise. */
  runtimeService?: RuntimeService;
  /** Request/DO `waitUntil`. Absent (a cron sweep, a container op), background work the
   *  dispatch schedules is awaited before the follow-up call returns instead. */
  waitUntil?: (p: Promise<unknown>) => void;
}

/** The production ports. */
export function lateSteerPorts(deps: LateSteerDeps): LateSteerPorts {
  const { env, db } = deps;
  let runtimeService = deps.runtimeService;
  const runtime = async (): Promise<RuntimeService> => {
    if (!runtimeService) {
      // Lazy: most settles find nothing to claim and never need the service.
      const { buildRuntimeService } = await import('../../buildRuntimeService');
      runtimeService = buildRuntimeService(env, db);
    }
    return runtimeService;
  };
  return {
    async loadExecution(executionId, tenantId) {
      const [row] = await db
        .select({
          id: executions.id, tenantId: executions.tenantId, status: executions.status, taskId: executions.taskId,
          payload: executions.payload, agentHostId: executions.agentHostId, source: executions.source,
          cloudAgentRef: executions.cloudAgentRef, submittedBy: executions.submittedBy,
        })
        .from(executions)
        .where(tenantId != null ? and(eq(executions.id, executionId), eq(executions.tenantId, tenantId)) : eq(executions.id, executionId))
        .limit(1);
      return row ?? null;
    },
    async loadTask(tenantId, taskId) {
      const [row] = await db
        .select({
          id: tasks.id, title: tasks.title, description: tasks.description,
          assignedAgentHostId: tasks.assignedAgentHostId, assignedAgentRef: tasks.assignedAgentRef,
          assignedUserId: tasks.assignedUserId, priority: tasks.priority, projectId: tasks.projectId,
        })
        .from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(eq(tasks.id, taskId), eq(projects.tenantId, tenantId)))
        .limit(1);
      return (row as ExecutionTaskRow | undefined) ?? null;
    },
    repend: (executionId, ids) => repend(db, executionId, ids),
    claim: (executionId, ids) => claimLateSteers(db, executionId, ids),
    priorOutcome: (executionId, ids) => lateSteerOutcomeOf(db, executionId, ids),
    recordOutcome: (ids, outcome) => recordLateSteerOutcome(db, ids, outcome),
    agentLabel: async (tenantId, agentRef) => (await resolveCloudAgent(env, tenantId, agentRef)).label ?? 'BuilderForce Agent',
    async startFollowUp(args) {
      const pending: Promise<unknown>[] = [];
      const waitUntil = deps.waitUntil ?? ((p: Promise<unknown>) => { pending.push(p); });
      const outcome = await startFollowUpRun(env, db, await runtime(), waitUntil, args);
      if (!deps.waitUntil) await Promise.allSettled(pending);
      return outcome;
    },
    timeline: (e) => recordCloudToolEvent(db, {
      tenantId: e.tenantId, executionId: e.executionId, agentHostId: e.agentHostId,
      ...(e.cloudAgentRef ? { cloudAgentRef: e.cloudAgentRef } : {}),
      toolName: e.toolName, category: 'message', detail: e.detail, result: e.result,
    }),
  };
}

/**
 * For the terminal chokepoints: settle a run's late steers without ever failing the
 * caller's terminal path. A failure is REPORTED (the steers stay pending, so the next
 * chokepoint — or the orphan sweep — can still claim them), never swallowed.
 */
export async function settleLateSteersSafely(deps: LateSteerDeps, args: { executionId: number; tenantId?: number }): Promise<LateSteerOutcome> {
  try {
    return await settleLateSteers(lateSteerPorts(deps), args);
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/runtime/lateSteerFollowUp.ts',
      operation: 'settleLateSteers',
      context: { logMessage: '[late-steer] settling late steers failed; they remain pending', details: { executionId: args.executionId, tenantId: args.tenantId ?? null } },
    });
    return { kind: 'none' };
  }
}
