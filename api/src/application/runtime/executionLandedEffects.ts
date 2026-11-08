import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * executionLandedEffects - the ONE fan-out that follows an execution status WRITE that won its guard.
 *
 * `RuntimeService.update` lands a RUNNING / COMPLETED / FAILED transition and then owes the world a set of side effects: the task-lane
 * sync, ticket metrics, the managed-board callback, manifest attribution, the next-lane trigger, the chat milestone, the audit event
 * and the terminal-failure telemetry. A writer that lands a status some other way (the stale-run reaper's set-based UPDATE) must owe
 * exactly the same effects, so they live here and both call them - there is no second, thinner copy that can drift.
 *
 * Every effect is best-effort and isolated ({@link runIsolatedEffect}): a failing one is retried, reported and audited without
 * preventing the next.
 */
import type { ITaskRepository } from '../../domain/task/ITaskRepository';
import type { IAuditRepository } from '../../domain/audit/IAuditRepository';
import type { Execution } from '../../domain/execution/Execution';
import type { Task } from '../../domain/task/Task';
import { AuditEvent } from '../../domain/audit/AuditEvent';
import { AuditEventType, ExecutionStatus, TaskStatus, asTaskId, asTenantId } from '../../domain/shared/types';
import { isValidatorReviewPayload } from '../validation/validatorReviewMarker';
import { isIncidentTriagePayload } from '../incident/incidentTriageMarker';
import { parseActAsRole, isRoleAttributedRun } from './cloudDispatch';
import { isLifecycleNeutralRun } from './executionAuthority';
import { isSubagentRun } from './cloudChildRuns';
import { mapWithConcurrency } from './boundedPool';
import { ticketKindForTaskType } from '../brain/ChatTicketService';
import type { RuntimePorts } from './ports';

/** What the fan-out reads of a landed run. An `Execution` satisfies it; so does a set-based UPDATE's RETURNING row. */
export interface LandedRun {
  id: number;
  tenantId: number;
  taskId: number;
  payload: string | null;
  cloudAgentRef: string | null;
  agentHostId: number | null;
}

/** The transition that landed. */
export interface LandedOutcome {
  status: ExecutionStatus.RUNNING | ExecutionStatus.COMPLETED | ExecutionStatus.FAILED;
  result?: string;
  errorMessage?: string;
}

/** The collaborators the fan-out calls through. */
export interface LandedEffectDeps {
  tasks: ITaskRepository;
  audit: IAuditRepository;
  ports: RuntimePorts;
}

/** Project an `Execution` (or anything shaped like one) onto the fields the fan-out reads. */
export function landedRunOf(e: Execution): LandedRun {
  return {
    id: Number(e.id), tenantId: Number(e.tenantId), taskId: Number(e.taskId),
    payload: e.payload, cloudAgentRef: e.cloudAgentRef, agentHostId: e.agentHostId != null ? Number(e.agentHostId) : null,
  };
}

/** Recover the lane an auto-run dispatch was started FOR from its stored payload (the auto-run trigger stamps `laneKey`).
 *  Tolerates a null / malformed payload - a manual or host run has no stamp, so the same-lane loop guard simply won't apply. */
export function parseLaneKey(payload: string | null): string | undefined {
  if (!payload) return undefined;
  try {
    const obj = JSON.parse(payload) as { laneKey?: unknown };
    return typeof obj.laneKey === 'string' ? obj.laneKey : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run one idempotent lifecycle side effect in isolation. A failure is retried, logged with correlation fields, and recorded as a
 * tenant audit event without preventing later effects from running.
 */
export async function runIsolatedEffect<T>(
  audit: IAuditRepository,
  name: string,
  context: { tenantId: number; executionId: number; taskId?: number; projectId?: number },
  effect: () => Promise<T>,
  fallback: T,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await effect();
    } catch (error) {
      lastError = error;
      reportCaughtError(error, { source: "application/runtime/executionLandedEffects.ts", operation: "runIsolatedEffect", context: { logMessage: '[runtime-effect] failed', details: {
        effect: name,
        attempt,
        maxAttempts: 3,
        ...context,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      } } });
    }
  }

  try {
    await audit.save(AuditEvent.create({
      tenantId: asTenantId(context.tenantId),
      userId: null,
      eventType: 'execution_effect_failed' as AuditEventType,
      resourceType: 'execution_effect',
      resourceId: String(context.executionId),
      metadata: JSON.stringify({
        effect: name,
        attempts: 3,
        taskId: context.taskId ?? null,
        projectId: context.projectId ?? null,
        error: lastError instanceof Error ? `${lastError.name}: ${lastError.message}` : String(lastError),
      }),
    }));
  } catch (auditError) {
    reportCaughtError(auditError, { source: "application/runtime/executionLandedEffects.ts", operation: "runIsolatedEffect", context: { logMessage: '[runtime-effect] failure audit write threw', details: {
      effect: name,
      ...context,
      error: auditError instanceof Error ? `${auditError.name}: ${auditError.message}` : String(auditError),
    } } });
  }
  return fallback;
}

/**
 * The lifecycle fan-out for a status write that won: task-lane sync, ticket metrics, the managed-board callback, manifest
 * attribution, the next-lane trigger and the chat milestone. Never throws. `movedTicket` is true when a COMPLETED run advanced its
 * ticket to a new lane (the caller then stamps `produced`).
 */
export async function applyLandedLifecycle(
  deps: LandedEffectDeps,
  run: LandedRun,
  outcome: LandedOutcome,
  /** The run's ticket when the caller already loaded it (a batch caller loads many in one query); absent: read it here. */
  preloadedTask?: Task | null,
): Promise<{ movedTicket: boolean }> {
  const { tasks, audit, ports } = deps;
  const runEffect = <T>(name: string, ctx: { tenantId: number; executionId: number; taskId?: number; projectId?: number }, effect: () => Promise<T>, fallback: T) =>
    runIsolatedEffect(audit, name, ctx, effect, fallback);
  let movedTicket = false;

  // sync task status based on execution state --------------------------------
  // Each lane move here is an AGENT moving a ticket - recorded into the ticket-
  // metrics layer via onTaskStatusSync so it counts exactly like a human PATCH
  // (and a terminal run stamps the work-stopped signal even on FAILED, where the
  // lane doesn't change). See syncExecutionTaskLifecycle.
  try {
    const task = preloadedTask !== undefined ? preloadedTask : await tasks.findById(asTaskId(run.taskId));
    if (task) {
      const fromStatus = task.status;
      const projectId = task.toPlain().projectId;
      const tenantId = run.tenantId;
      let toStatus: string = fromStatus;
      const terminal = outcome.status === ExecutionStatus.COMPLETED || outcome.status === ExecutionStatus.FAILED;
      // A Validator acceptance review runs AGAINST an already-Done ticket and must
      // NOT move its lane - otherwise a completing review knocks the ticket back to
      // in_review and re-triggers a review (the completion loop). Record the terminal
      // signal for metrics but leave the ticket exactly where it is.
      const isReviewRun = isValidatorReviewPayload(run.payload);
      // An incident-triage run works the bridged INCIDENT ticket (classify/page/notes,
      // no code) and likewise must not move its lane - the lane mirrors the incident's
      // own status (IncidentService.updateIncident), not the run's completion.
      const isIncidentTriageRun = isIncidentTriagePayload(run.payload);
      // A ROLE-ATTRIBUTED run (a reviewer asked for a verdict, or a producer asked for
      // this stage's deliverable) likewise runs against an already-open ticket. Its
      // VERDICT is what advances the stage - the run merely completing is not - so it
      // must not move the lane. Omitting this is why a 20-second sign-off run pushed
      // task 387 out of `in_review` 1.5 seconds after finishing, whatever it decided,
      // and it is half of the `in_review -> ready` churn (the other half is the
      // Coordinator rewind). The manifest attribution below still runs, so the run's
      // evidence lands on its slot exactly as before.
      const isRoleRun = isRoleAttributedRun(run.payload);
      // A run a MANAGED board admitted on an AUTHORITY rather than a role - a person
      // directing execution from a surface that cannot see the board type, or platform
      // machinery (compile, security audit, validation, CI auto-fix) that performs no
      // role at all. Letting those run is the point; letting them ADVANCE the ticket
      // would be the hole, because a managed stage may only move on a recorded verdict
      // from a role accountable for it. The dispatcher stamps the marker at the single
      // point that knows the board is managed (`markLifecycleNeutral`), so this hold
      // costs nothing on an unmanaged board - no run there is ever marked.
      const isNeutralRun = isLifecycleNeutralRun(run.payload);
      // A cloud sub-agent (also neutral, so it holds the lane) is a slice of its
      // parent's run: no role attribution and no milestone of its own.
      const isChildRun = isSubagentRun(run.payload);
      // All four classes run against an already-open ticket and hold its lane.
      const holdsLane = isReviewRun || isIncidentTriageRun || isRoleRun || isNeutralRun;
      const effectContext = { tenantId, taskId: run.taskId, projectId, executionId: run.id };
      // Holding the lane and coordinating the lifecycle are separate decisions.
      // Role-attributed runs must not take the legacy RUNNING->in_progress /
      // COMPLETED->next-lane path, but their terminal event MUST reach the managed
      // callback: that callback first persists the role's evidence/verdict, then
      // immediately evaluates whether the stage can advance. Suppressing it here
      // left completed role work waiting for the periodic manager sweep (observed as
      // a 108-minute developer->reviewer hand-off gap on task 1377).
      // A neutral run is excluded here too, and for the same reason it holds the lane:
      // it carries no role evidence for the coordinator to persist, so the only thing
      // its terminal event could do there is trigger a stage transition it has no
      // standing to cause. A ROLE run still reaches the coordinator - that is what
      // stops completed role work waiting for the periodic sweep.
      const mayCoordinateManagedLifecycle = !isReviewRun && !isIncidentTriageRun && !isNeutralRun;
      const managedResult = mayCoordinateManagedLifecycle && ports.onManagedRunStatus
        && (outcome.status === ExecutionStatus.RUNNING || terminal)
        ? await runEffect('managed_run_status', effectContext, () => ports.onManagedRunStatus!({
            ...effectContext,
            status: outcome.status === ExecutionStatus.RUNNING ? 'running' : outcome.status === ExecutionStatus.COMPLETED ? 'completed' : 'failed',
            fromStatus, actAsRole: parseActAsRole(run.payload) ?? null,
            laneServed: parseLaneKey(run.payload) ?? fromStatus,
          }), { managed: false, toStatus: fromStatus })
        : undefined;
      const coordinatorOwnsTransition = managedResult?.managed === true;
      if (coordinatorOwnsTransition) toStatus = managedResult.toStatus;

      if (!coordinatorOwnsTransition && !holdsLane && outcome.status === ExecutionStatus.RUNNING && fromStatus !== TaskStatus.IN_PROGRESS) {
        // The board decides which lane "work is happening" IS - see
        // {@link RuntimePorts.resolveRunningStatus}. Falls back to the legacy constant only when no
        // resolver is wired (tests, a non-board task), and a null verdict means the
        // ticket stays put rather than being written to a lane the board does not have.
        const runningKey = ports.resolveRunningStatus
          ? await runEffect(
              'resolve_running_status',
              effectContext,
              () => ports.resolveRunningStatus!({
                projectId, fromStatus, dispatchedLaneKey: parseLaneKey(run.payload) ?? null,
              }),
              null,
            )
          : TaskStatus.IN_PROGRESS;
        if (runningKey) {
          toStatus = runningKey;
          await runEffect(
            'task_status_running',
            effectContext,
            () => tasks.update(task.update({ status: runningKey })),
            task,
          );
        }
      }
      if (!coordinatorOwnsTransition && !holdsLane && outcome.status === ExecutionStatus.COMPLETED) {
        const resultText = outcome.result ?? '';
        // Default advance is the board's NEXT swimlane by configured order - so a
        // custom board (renamed / re-ordered lanes) flows correctly instead of
        // always jumping to in_review. Falls back to in_review when there is no
        // board / the lane can't be resolved (a non-board task). A governance
        // token still short-circuits straight to Done.
        let newStatus: string = TaskStatus.IN_REVIEW;
        if (resultText.includes('[auto-approve]')) {
          newStatus = TaskStatus.DONE;
        } else {
          const nextKey = ports.resolveNextStatus
            ? await runEffect(
                'resolve_next_status',
                effectContext,
                () => ports.resolveNextStatus!({ projectId, fromStatus }),
                null,
              )
            : null;
          if (nextKey) newStatus = nextKey;
        }
        toStatus = newStatus;
        await runEffect(
          'task_status_completed',
          effectContext,
          () => tasks.update(task.update({ status: newStatus })),
          task,
        );
      }

      if (ports.onTaskStatusSync) {
        await runEffect(
          'task_status_sync',
          effectContext,
          () => ports.onTaskStatusSync!({
            tenantId, taskId: run.taskId, projectId, fromStatus, toStatus, terminal,
            // WHO moved it: the agent this execution ran as. A cloud run carries its
            // published/ide agent ref; an on-prem run carries its host id.
            actorAgentRef: run.cloudAgentRef,
            actorAgentHostId: run.agentHostId,
          }),
          undefined,
        );
      }

      // Manifest attribution (PRD 5.6): a terminal run records that the role it ran
      // AS participated on the ticket (linked to this execution), and - with producer
      // evidence - completes that role's manifest slot. Best-effort, never blocks.
      if (terminal && !coordinatorOwnsTransition && !isChildRun) {
        if (ports.onRunFinalized) {
          await runEffect('run_finalized', effectContext, () => ports.onRunFinalized!({
            ...effectContext,
            status: outcome.status === ExecutionStatus.COMPLETED ? 'completed' : 'failed',
            actAsRole: parseActAsRole(run.payload) ?? null,
            laneServed: parseLaneKey(run.payload) ?? fromStatus,
          }), undefined);
        }
      }

      // Autonomous chaining: this agent just advanced the ticket into a NEW
      // non-terminal lane. Fire the same lane auto-run trigger a human board-drag
      // uses so that lane's configured agent starts - parity with the PATCH path.
      // A Done lane finalizes (PR/commit) instead of staffing a fresh agent, and
      // the RUNNING->in_progress move is the lane the CURRENT run already owns, so
      // both are excluded here (the trigger also dedupes/no-ops defensively).
      if (!coordinatorOwnsTransition && !holdsLane && outcome.status === ExecutionStatus.COMPLETED && toStatus !== fromStatus && toStatus !== TaskStatus.DONE) {
        if (ports.onLaneEntry) {
          await runEffect('lane_entry_dispatch', effectContext, () => ports.onLaneEntry!({
            tenantId, taskId: run.taskId, projectId, status: toStatus,
            originLaneKey: parseLaneKey(run.payload),
          }), undefined);
        }
      }

      // Narrate the run's progress back into the ticket's linked Brain chats (started >
      // completed > failed) so a dev agent's work is visible in the conversation that
      // spawned it. A Validator review run is internal and stays silent - except when it FAILS: a review that died is
      // something the people on the ticket must hear, and every landing path (update, the orphan repair, the cron reaper) owes it. LAST side-effect so a
      // milestone failure can't block the lane sync/chaining above; the hook is itself
      // best-effort + per-execution+phase idempotent.
      if (!isChildRun && (!isReviewRun || outcome.status === ExecutionStatus.FAILED)) {
        const taskType = (task.toPlain() as { taskType?: string }).taskType;
        // `started` fires on EVERY RUNNING transition, not only when the lane flips to
        // in_progress - a re-run on a ticket already in progress and a Coordinator-managed
        // lane both start silently otherwise. The per-execution+phase idempotency key
        // (run:{id}:started) collapses repeats (heartbeat re-marks, resume) to one post.
        const phase = outcome.status === ExecutionStatus.RUNNING ? 'started' as const
          : outcome.status === ExecutionStatus.COMPLETED ? 'completed' as const
          : outcome.status === ExecutionStatus.FAILED ? 'failed' as const : null;
        if (phase && ports.onRunMilestone) {
          await runEffect('run_milestone', effectContext, () => ports.onRunMilestone!({
            tenantId, taskId: run.taskId, projectId,
            taskType: ticketKindForTaskType(taskType),
            agentRef: run.cloudAgentRef, executionId: run.id, phase,
            toStatus, resultText: outcome.result ?? null, errorMessage: outcome.errorMessage ?? null,
          }), undefined);
        }
      }
      movedTicket = outcome.status === ExecutionStatus.COMPLETED && toStatus !== fromStatus;
    }
  } catch (error) {
    reportCaughtError(error, { source: "application/runtime/executionLandedEffects.ts", operation: "applyLandedLifecycle", context: { logMessage: '[runtime-update] lifecycle orchestration failed outside an isolated effect', details: {
      executionId: run.id,
      tenantId: run.tenantId,
      taskId: run.taskId,
      status: outcome.status,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    } } });
  }
  return { movedTicket };
}

/** The audit event a landed transition owes (`metadata`: the writer's own detail, or null). */
export async function recordLandedAudit(
  audit: IAuditRepository,
  run: LandedRun,
  status: LandedOutcome['status'],
  metadata: string | null,
): Promise<void> {
  const eventType = status === ExecutionStatus.RUNNING
    ? AuditEventType.EXECUTION_STARTED
    : status === ExecutionStatus.COMPLETED
      ? AuditEventType.EXECUTION_COMPLETED
      : AuditEventType.EXECUTION_FAILED;
  await audit.save(AuditEvent.create({
    tenantId:     asTenantId(run.tenantId),
    userId:       null,
    eventType,
    resourceType: 'execution',
    resourceId:   String(run.id),
    metadata,
  }));
}

/** Runs settled per prefetch and per pool: one ticket query of at most this many ids. */
export const SETTLE_CHUNK_SIZE = 100;
/** Runs settled at once. Each settle is several isolated round trips, so a handful in flight keeps a big reap well inside the tick. */
export const SETTLE_CONCURRENCY = 5;

/**
 * Everything a run that was FAILED by a set-based write (the stale-run reaper's UPDATE) owes beyond its row: the lifecycle fan-out
 * and the audit event. Failure telemetry stays with the caller, which batches it ({@link runFailureEventValues}); chat narration is
 * the fan-out's own `run_milestone`. One failing run never stops the rest.
 *
 * Bounded: runs are settled in chunks of {@link SETTLE_CHUNK_SIZE} (one batched ticket read per chunk) with
 * {@link SETTLE_CONCURRENCY} in flight. Every run is settled - a run is already FAILED by the time it gets here, so the reaper's
 * selection can never find it again and dropping a remainder would lose its effects for good; the bound is on work per step, not on
 * what is owed.
 */
export async function settleLandedFailures(
  deps: LandedEffectDeps,
  runs: ReadonlyArray<LandedRun & { errorMessage: string | null }>,
): Promise<void> {
  for (let start = 0; start < runs.length; start += SETTLE_CHUNK_SIZE) {
    await settleChunk(deps, runs.slice(start, start + SETTLE_CHUNK_SIZE));
  }
}

async function settleChunk(deps: LandedEffectDeps, runs: ReadonlyArray<LandedRun & { errorMessage: string | null }>): Promise<void> {
  // ONE query for the chunk's tickets (no N+1); the per-run effects below still act per ticket, because each reads its own state.
  const taskIds = [...new Set(runs.map((r) => r.taskId))];
  const loaded = taskIds.length === 0 ? [] : await deps.tasks.findByIdsAcrossTenants(taskIds.map(asTaskId)).catch((error) => {
    reportCaughtError(error, { source: "application/runtime/executionLandedEffects.ts", operation: "settleLandedFailures", context: { logMessage: '[runtime-reap] ticket prefetch failed', details: { taskIds } } });
    return null;
  });
  const byId = loaded ? new Map(loaded.map((t) => [Number(t.toPlain().id), t])) : null;
  await mapWithConcurrency(runs, SETTLE_CONCURRENCY, async (run) => {
    // A failed prefetch falls back to the per-run read inside applyLandedLifecycle; a missing id means the ticket is gone. The
    // batch read is not tenant-scoped, so a ticket owned by another workspace is treated as gone rather than acted on.
    const found = byId ? (byId.get(run.taskId) ?? null) : undefined;
    const foreignTenant = found != null && found.toPlain().tenantId != null && found.toPlain().tenantId !== run.tenantId;
    const task = foreignTenant ? null : found;
    await applyLandedLifecycle(deps, run, { status: ExecutionStatus.FAILED, errorMessage: run.errorMessage ?? undefined }, task);
    await recordLandedAudit(deps.audit, run, ExecutionStatus.FAILED, JSON.stringify({ reason: run.errorMessage ?? 'reaped' }))
      .catch((error) => reportCaughtError(error, { source: "application/runtime/executionLandedEffects.ts", operation: "settleLandedFailures", context: { logMessage: '[runtime-reap] audit write failed', details: { executionId: run.id } } }));
  });
}

