import { reportCaughtError } from '../observability/caughtErrorReporter';
import { isValidatorReviewPayload } from '../validation/validatorReviewMarker';
import { isIncidentTriagePayload } from '../incident/incidentTriageMarker';
import { IExecutionRepository } from '../../domain/execution/IExecutionRepository';
import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IAgentRepository } from '../../domain/agent/IAgentRepository';
import { IAuditRepository } from '../../domain/audit/IAuditRepository';
import { Execution } from '../../domain/execution/Execution';
import { AuditEvent } from '../../domain/audit/AuditEvent';
import {
  AuditEventType, ExecutionStatus,
  asExecutionId, asTaskId, asAgentId, asAgentHostId, asTenantId, TaskStatus,
} from '../../domain/shared/types';
import { NotFoundError, ForbiddenError, ServiceUnavailableError } from '../../domain/shared/errors';
import {
  cloudOrphanReason, cloudSilenceCeilingMs, HOST_ORPHAN_REASON,
  PAUSED_DEADLINE_MS, PAUSED_ORPHAN_REASON,
} from './orphanReasons';
import { parseExecutor, parseActAsRole, parseCloudAgentRef, isRoleAttributedRun } from './cloudDispatch';
import { isLifecycleNeutralRun } from './executionAuthority';
import { ticketKindForTaskType } from '../brain/ChatTicketService';
import type { RuntimePorts, RuntimeServiceOptions } from './ports';
import { notifyExecutionSubscribers } from './executionEvents';
import { EXECUTION_NON_TERMINAL_STATUSES } from '../../domain/shared/terminalStatus';

export interface SubmitTaskDto {
  taskId:      number;
  agentId?:    number;
  agentRegistrationId?: string;
  agentHostId?:     number | null;
  tenantId:    number;
  submittedBy: string;
  sessionId?:  string | null;
  payload?:    string;
  /** Trusted execution surface, assigned by server routing/auth context. */
  source?:     'agent' | 'vscode' | 'brain';
}

export interface UpdateExecutionDto {
  status:        ExecutionStatus;
  result?:       string;
  errorMessage?: string;
}

/** Recover the lane an auto-run dispatch was started FOR from its stored payload
 *  (the auto-run trigger stamps `laneKey`). Tolerates null/malformed payload — a
 *  manual or host run has no stamp, so the same-lane loop guard simply won't apply. */
function parseLaneKey(payload: string | null): string | undefined {
  if (!payload) return undefined;
  try {
    const obj = JSON.parse(payload) as { laneKey?: unknown };
    return typeof obj.laneKey === 'string' ? obj.laneKey : undefined;
  } catch {
    return undefined;
  }
}


/**
 * RuntimeService — the execution engine.
 *
 * Orchestrates the task execution lifecycle:
 *   submit → dispatch to agent → track state → complete / fail / cancel
 */
export class RuntimeService {
  /** Executions still in flight — anything not COMPLETED/FAILED/CANCELLED.
   *  The status set {@link listActiveByTasks} scans to answer "does this ticket
   *  still have a live run?" in one query across many tasks. */
  static readonly NON_TERMINAL_STATUSES: ExecutionStatus[] = [...EXECUTION_NON_TERMINAL_STATUSES];

  private readonly executions: IExecutionRepository;
  private readonly tasks:      ITaskRepository;
  private readonly agents:     IAgentRepository;
  private readonly audit:      IAuditRepository;
  /** Every optional side-effect / resolver seam — see {@link RuntimePorts}. */
  private readonly ports:      RuntimePorts;

  constructor(options: RuntimeServiceOptions) {
    const { executions, tasks, agents, audit, ...ports } = options;
    this.executions = executions;
    this.tasks = tasks;
    this.agents = agents;
    this.audit = audit;
    this.ports = ports;
  }

  /**
   * Run one idempotent lifecycle side effect in isolation. A failure is retried,
   * logged with correlation fields, and recorded as a tenant audit event without
   * preventing later effects from running.
   */
  private async runEffect<T>(
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
        reportCaughtError(error, { source: "application/runtime/RuntimeService.ts", operation: "runEffect", context: { logMessage: '[runtime-effect] failed', details: {
          effect: name,
          attempt,
          maxAttempts: 3,
          ...context,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        } } });
      }
    }

    try {
      await this.audit.save(AuditEvent.create({
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
      reportCaughtError(auditError, { source: "application/runtime/RuntimeService.ts", operation: "runEffect", context: { logMessage: '[runtime-effect] failure audit write threw', details: {
        effect: name,
        ...context,
        error: auditError instanceof Error ? `${auditError.name}: ${auditError.message}` : String(auditError),
      } } });
    }
    return fallback;
  }

  /**
   * Stamp the effective governance gates onto a dispatch payload. Returns the
   * payload unchanged when nothing resolves or when the resolver is unwired. A
   * wired resolver that fails is fail-closed: an agent run must not start without
   * knowing which governance policy applies.
   * the caller ALREADY carried gates (a `deploy()`-and-dispatch run compiles its
   * own onto the spec — the explicit spec wins over the ambient tenant policy).
   */
  private async withPolicyGates(
    payload: string | undefined,
    tenantId: number,
    projectId: number | null,
  ): Promise<string | undefined> {
    if (!this.ports.resolvePolicyGates) return payload;
    try {
      let obj: Record<string, unknown> = {};
      if (payload) {
        try { obj = JSON.parse(payload) as Record<string, unknown>; } catch { obj = {}; }
      }
      if (Array.isArray(obj.policyGates) && obj.policyGates.length > 0) return payload;

      const gates = await this.ports.resolvePolicyGates({
        tenantId, projectId, agentRef: parseCloudAgentRef(payload) ?? null,
      });
      if (gates.length === 0) return payload;
      obj.policyGates = gates;
      return JSON.stringify(obj);
    } catch (error) {
      reportCaughtError(error, { source: "application/runtime/RuntimeService.ts", operation: "withPolicyGates", context: { logMessage: '[runtime-policy] policy gate resolution failed; dispatch blocked', details: {
        tenantId,
        projectId,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      } } });
      throw new ServiceUnavailableError(
        'Agent execution is temporarily paused because governance policy could not be resolved. Try again shortly.',
      );
    }
  }

  /**
   * Post a lifecycle milestone for an execution whose row is written DIRECTLY —
   * bypassing {@link update}'s milestone emission: the ask_human pause + resume in
   * `CloudRunnerDO`, {@link cancel}, and the orphan reap ({@link reapIfOrphaned}).
   * Resolves the ticket + project the same way `update` does, then fans out via
   * {@link RuntimePorts.onRunMilestone}. Best-effort — never throws (chat narration must never
   * break the run's terminal write).
   */
  async postLifecycleMilestone(
    execution: Execution,
    phase: 'paused' | 'resumed' | 'cancelled' | 'failed',
    opts?: { errorMessage?: string | null; questionText?: string | null; eventNonce?: string | null },
  ): Promise<void> {
    try {
      const task = await this.tasks.findById(asTaskId(execution.taskId));
      if (!task) return;
      const plain = task.toPlain() as { projectId?: number; taskType?: string };
      await this.ports.onRunMilestone?.({
        tenantId: execution.tenantId, taskId: Number(execution.taskId),
        projectId: plain.projectId ?? 0, taskType: ticketKindForTaskType(plain.taskType),
        agentRef: execution.cloudAgentRef, executionId: Number(execution.id), phase,
        errorMessage: opts?.errorMessage ?? null,
        questionText: opts?.questionText ?? null,
        eventNonce: opts?.eventNonce ?? null,
      });
    } catch (error) {
      reportCaughtError(error, { source: "application/runtime/RuntimeService.ts", operation: "postLifecycleMilestone", context: { logMessage: '[runtime-milestone] lifecycle milestone failed', details: {
        executionId: Number(execution.id),
        tenantId: Number(execution.tenantId),
        phase,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      } } });
    }
  }

  /**
   * {@link postLifecycleMilestone} addressed by execution id — for direct-write
   * sites that hold only the id (the durable runner's pause/resume endpoints).
   * Loads the row WITHOUT the orphan-reap read path (narrating must never trigger
   * a repair write). Best-effort — never throws.
   */
  async postLifecycleMilestoneById(
    executionId: number,
    phase: 'paused' | 'resumed' | 'cancelled' | 'failed',
    opts?: { errorMessage?: string | null; questionText?: string | null; eventNonce?: string | null },
  ): Promise<void> {
    try {
      const e = await this.executions.findById(asExecutionId(executionId));
      if (e) await this.postLifecycleMilestone(e, phase, opts);
    } catch (error) {
      reportCaughtError(error, { source: "application/runtime/RuntimeService.ts", operation: "postLifecycleMilestoneById", context: { logMessage: '[runtime-milestone] lifecycle milestone lookup failed', details: {
        executionId,
        phase,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      } } });
    }
  }

  async submit(dto: SubmitTaskDto): Promise<Execution> {
    const source = dto.source ?? 'agent';
    if (source === 'agent' && this.ports.isAgentExecutionEnabled && !(await this.ports.isAgentExecutionEnabled(dto.tenantId))) {
      throw new ForbiddenError(
        'Agent execution is disabled for this workspace. A manager must re-enable it in Settings.',
      );
    }

    const task = await this.tasks.findById(asTaskId(dto.taskId));
    if (!task) throw new NotFoundError('Task', dto.taskId);

    if (dto.agentId !== undefined) {
      const agent = await this.agents.findById(asAgentId(dto.agentId));
      if (!agent) throw new NotFoundError('Agent', dto.agentId);
      if (!agent.isActive) throw new ForbiddenError('Agent is not active');
    }
    if (dto.agentRegistrationId !== undefined) {
      const registration = await this.ports.resolveAgentRegistration?.(dto.agentRegistrationId, dto.tenantId);
      if (!registration) throw new NotFoundError('Agent registration', dto.agentRegistrationId);
      if (!registration.active) throw new ForbiddenError('Agent registration is not active');
    }

    // Governance: stamp the tenant's effective policy gates onto the payload so the
    // engine's `evaluatePolicyGate` seam enforces them. Done here — the single
    // execution funnel — so EVERY dispatch path is gated, not just the ones that
    // remembered to ask.
    const projectId = (task.toPlain() as { projectId?: number }).projectId ?? null;
    const payload = await this.withPolicyGates(dto.payload, dto.tenantId, projectId);

    const execution = await this.executions.save(
      Execution.create({
        taskId:      asTaskId(dto.taskId),
        agentId:     dto.agentId != null ? asAgentId(dto.agentId) : null,
        agentRegistrationId: dto.agentRegistrationId ?? null,
        agentHostId:      dto.agentHostId != null ? asAgentHostId(dto.agentHostId) : null,
        tenantId:    asTenantId(dto.tenantId),
        submittedBy: dto.submittedBy,
        sessionId:   dto.sessionId ?? null,
        payload:     payload ?? null,
        source,
      }),
    );

    await this.audit.save(AuditEvent.create({
      tenantId:     asTenantId(dto.tenantId),
      userId:       dto.submittedBy,
      eventType:    AuditEventType.TASK_SUBMITTED,
      resourceType: 'execution',
      resourceId:   String(execution.id),
      metadata:     JSON.stringify({
        taskId: dto.taskId,
        agentId: dto.agentId,
        agentRegistrationId: dto.agentRegistrationId ?? null,
        agentHostId: dto.agentHostId ?? null,
        sessionId: dto.sessionId ?? null,
        source,
      }),
    }));

    // ── THE RUN EXISTS NOW — SAY SO ON THE BOARD ────────────────────────────────
    // Every LATER lifecycle event fans out to the project room (pending→running→done),
    // but CREATION did not: an autonomously dispatched run appeared on the board only
    // when `useBoardLiveRuns` next polled, so a ticket a human had just dragged sat
    // visibly idle for up to a poll interval while the agent was already working.
    // Same notifier, same event shape — the sink ignores anything that is not a
    // lifecycle event, and a `status_change` at creation IS one.
    notifyExecutionSubscribers(execution.id, {
      type: 'status_change',
      executionId: execution.id,
      status: execution.toPlain().status,
      execution: execution.toPlain(),
      ts: new Date().toISOString(),
    });

    return execution;
  }

  async getExecution(id: number): Promise<Execution> {
    const e = await this.executions.findById(asExecutionId(id));
    if (!e) throw new NotFoundError('Execution', id);
    return this.reapIfOrphaned(e);
  }

  async listByTask(taskId: number): Promise<Execution[]> {
    const list = await this.executions.findByTask(asTaskId(taskId));
    return Promise.all(list.map((e) => this.reapIfOrphaned(e)));
  }

  /** Non-terminal executions across MANY tasks in one scan (reaped for orphans),
   *  so a coordinator can decide "does this ticket still have a live run?" without
   *  a listByTask() round-trip per task. */
  async listActiveByTasks(taskIds: number[]): Promise<Execution[]> {
    if (taskIds.length === 0) return [];
    const list = await this.executions.findByTasksAndStatuses(
      taskIds.map(asTaskId),
      RuntimeService.NON_TERMINAL_STATUSES,
    );
    return Promise.all(list.map((e) => this.reapIfOrphaned(e)));
  }

  /**
   * Cloud runs execute in a `waitUntil` background task; if that isolate is
   * evicted (or an update throws) before writing a terminal status, the row is
   * left non-terminal and the UI polls "running" forever even though nothing is
   * executing — the "says completed but still running" symptom. There is no live
   * process to recover, so once a run exceeds a per-kind ceiling we mark it failed
   * on read.
   *
   * The cloud ceiling comes from {@link cloudSilenceCeilingMs} (keyed off the executor
   * stamped on the payload at dispatch). BOTH cloud executors — the durable
   * CloudRunnerDO and the Cloudflare Container — are long-lived: each heartbeats
   * `updatedAt` once per alarm tick, and a tick legitimately spans one slow LLM step
   * (60-90s+), so both get the generous long-lived ceiling, measured from last activity
   * below, and only a SILENT (crashed/hung) run is reaped. {@link orphanReason} then
   * reports it as a crash rather than a timeout. (There used to be a second, tight 90s
   * ceiling for an in-request Worker loop; that executor was unreachable and has been
   * removed.) A self-hosted host has a real long-lived process and keeps a far larger
   * ceiling still.
   *
   * Read-path repair (no cron needed): the stream's reconciliation poll calls
   * `getExecution` every few seconds, so an orphan self-heals on next view.
   * Bounded — only stale, non-terminal rows incur a write; healthy reads don't.
   */
  private static readonly HOST_ORPHAN_MS = 30 * 60_000;

  private isCloudRun(e: Execution): boolean {
    return e.agentHostId == null;
  }

  private isOrphaned(e: Execution, nowMs: number): boolean {
    // A run PAUSED on an `ask_human` question is live-but-idle: no executor is
    // burning time, so the silence ceilings below would be nonsense. It gets its own
    // GENEROUS deadline instead ({@link PAUSED_DEADLINE_MS}) — but it does get one.
    // Both `evaluateTaskAutoRun` and `laneRequirementGate` count 'paused' as a LIVE
    // run, and nothing used to reap one, so an unanswered question blocked every
    // future auto-run on that ticket forever.
    if (e.status === ExecutionStatus.PAUSED) {
      const idleSince = (e.updatedAt ?? e.startedAt ?? e.createdAt).getTime();
      return nowMs - idleSince > PAUSED_DEADLINE_MS;
    }
    const live = e.status === ExecutionStatus.PENDING
      || e.status === ExecutionStatus.SUBMITTED
      || e.status === ExecutionStatus.RUNNING;
    if (!live) return false;
    // Cloud runs are measured from last activity (`updatedAt`), not start: a
    // CloudRunnerDO bumps updatedAt every alarm tick, so a healthy multi-minute
    // run looks alive (heartbeat) and only a run that has gone silent for the
    // ceiling is reaped. The dying interim Worker loop never bumps updatedAt mid-
    // run, so it still fast-fails ~90s after it started. A self-hosted host
    // measures from start with a far larger ceiling.
    const sinceMs = this.isCloudRun(e)
      ? (e.updatedAt ?? e.createdAt).getTime()
      : (e.startedAt ?? e.updatedAt ?? e.createdAt).getTime();
    // Cloud ceiling is per-surface: a long-lived executor (durable DO / container)
    // heartbeats once per alarm tick and a tick spans one (possibly slow) LLM step, so
    // it must not be reaped at the serverless 90s wall — only the in-request 'worker'
    // loop keeps that tight fast-fail (execution #136: a 93s durable tick reaped at 90s
    // while still alive). The executor is stamped on the payload at dispatch.
    const ceiling = this.isCloudRun(e)
      ? cloudSilenceCeilingMs(parseExecutor(e.payload))
      : RuntimeService.HOST_ORPHAN_MS;
    return nowMs - sinceMs > ceiling;
  }

  /** Actionable reason for a reaped run. Cloud runs split by how long they made
   *  progress: a short-lived one hit the serverless ~30s wall, while one that
   *  heartbeated past the wall ran on a long-lived executor (durable/container) and
   *  crashed — so it must NOT be told to "downgrade to a durable runtime". Host runs
   *  lost their process/connection. */
  private orphanReason(e: Execution): string {
    if (e.status === ExecutionStatus.PAUSED) return PAUSED_ORPHAN_REASON;
    if (!this.isCloudRun(e)) return HOST_ORPHAN_REASON;
    const startedMs = (e.startedAt ?? e.createdAt)?.getTime();
    const lastActivityMs = (e.updatedAt ?? e.createdAt)?.getTime();
    return cloudOrphanReason(startedMs, lastActivityMs);
  }

  private async reapIfOrphaned(e: Execution): Promise<Execution> {
    if (!this.isOrphaned(e, Date.now())) return e;
    // Cloud runs: attempt the once-only durable self-heal BEFORE failing, so a
    // crashed/evicted run recovers regardless of who detects it first. Idempotent —
    // a run that already used its retry just falls through to the normal fail.
    if (this.isCloudRun(e) && this.ports.onCloudOrphan) {
      try {
        if ((await this.ports.onCloudOrphan(e)) === 'requeued') {
          return (await this.executions.findById(asExecutionId(e.id))) ?? e;
        }
      } catch (error) {
        reportCaughtError(error, { source: "application/runtime/RuntimeService.ts", operation: "reapIfOrphaned", context: { logMessage: '[runtime-orphan] cloud self-heal threw; marking run failed', details: {
          executionId: Number(e.id),
          tenantId: Number(e.tenantId),
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        } } });
      }
    }
    try {
      const failed = e.markFailed(this.orphanReason(e));
      const saved = await this.executions.update(failed);
      await this.audit.save(AuditEvent.create({
        tenantId:     e.tenantId,
        userId:       null,
        eventType:    AuditEventType.EXECUTION_FAILED,
        resourceType: 'execution',
        resourceId:   String(e.id),
        metadata:     JSON.stringify({ reason: 'orphaned_timeout', priorStatus: e.status }),
      }));
      // Surface the orphan failure on the Logs/Timeline (telemetry-only views).
      await this.ports.onTerminalFailure?.(saved);
      // …and into the ticket's linked Brain chats: a human driving the conversation
      // must hear that the run died, not just watch the board stop moving. Idempotent
      // (run:{id}:failed), so racing the cron reaper's own narration is harmless.
      await this.postLifecycleMilestone(saved, 'failed', { errorMessage: this.orphanReason(e) });
      return saved;
    } catch (error) {
      reportCaughtError(error, { source: "application/runtime/RuntimeService.ts", operation: "reapIfOrphaned", context: { logMessage: '[runtime-orphan] failed to persist orphan transition', details: {
        executionId: Number(e.id),
        tenantId: Number(e.tenantId),
        priorStatus: e.status,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      } } });
      return e; // best-effort — never block a read on the repair
    }
  }

  async listByTenant(tenantId: number, limit?: number): Promise<Execution[]> {
    return this.executions.findByTenant(asTenantId(tenantId), limit);
  }

  async listBySession(tenantId: number, sessionId: string, limit?: number): Promise<Execution[]> {
    return this.executions.findBySession(asTenantId(tenantId), sessionId, limit);
  }

  async cancel(id: number, cancelledBy: string): Promise<Execution> {
    const execution = await this.getExecution(id);
    const cancelled = execution.cancel();
    const saved     = await this.executions.update(cancelled);

    await this.audit.save(AuditEvent.create({
      tenantId:     execution.tenantId,
      userId:       cancelledBy,
      eventType:    AuditEventType.TASK_CANCELLED,
      resourceType: 'execution',
      resourceId:   String(saved.id),
      metadata:     null,
    }));

    // Narrate the cancellation into the ticket's linked chats (bypasses update()).
    await this.postLifecycleMilestone(saved, 'cancelled');

    return saved;
  }

  /**
   * Called by an agent (or webhook) to update execution state.
   * Transitions: submitted→running, running→completed|failed
   */
  async update(id: number, dto: UpdateExecutionDto): Promise<Execution> {
    let execution = await this.getExecution(id);

    switch (dto.status) {
      case ExecutionStatus.RUNNING:
        execution = execution.markRunning();
        break;
      case ExecutionStatus.COMPLETED:
        execution = execution.markCompleted(dto.result ?? '');
        break;
      case ExecutionStatus.FAILED:
        execution = execution.markFailed(dto.errorMessage ?? 'Unknown error');
        break;
      default:
        throw new ForbiddenError(`Cannot transition to status '${dto.status}' via this endpoint`);
    }

    let saved = await this.executions.update(execution);
    let movedTicket = false;

    // sync task status based on execution state --------------------------------
    // Each lane move here is an AGENT moving a ticket — recorded into the ticket-
    // metrics layer via onTaskStatusSync so it counts exactly like a human PATCH
    // (and a terminal run stamps the work-stopped signal even on FAILED, where the
    // lane doesn't change). See syncExecutionTaskLifecycle.
    try {
      const task = await this.tasks.findById(execution.taskId);
      if (task) {
        const fromStatus = task.status;
        const projectId = task.toPlain().projectId;
        const tenantId = Number(execution.tenantId);
        let toStatus: string = fromStatus;
        const terminal = dto.status === ExecutionStatus.COMPLETED || dto.status === ExecutionStatus.FAILED;
        // A Validator acceptance review runs AGAINST an already-Done ticket and must
        // NOT move its lane — otherwise a completing review knocks the ticket back to
        // in_review and re-triggers a review (the completion loop). Record the terminal
        // signal for metrics but leave the ticket exactly where it is.
        const isReviewRun = isValidatorReviewPayload(execution.payload);
        // An incident-triage run works the bridged INCIDENT ticket (classify/page/notes,
        // no code) and likewise must not move its lane — the lane mirrors the incident's
        // own status (IncidentService.updateIncident), not the run's completion.
        const isIncidentTriageRun = isIncidentTriagePayload(execution.payload);
        // A ROLE-ATTRIBUTED run (a reviewer asked for a verdict, or a producer asked for
        // this stage's deliverable) likewise runs against an already-open ticket. Its
        // VERDICT is what advances the stage — the run merely completing is not — so it
        // must not move the lane. Omitting this is why a 20-second sign-off run pushed
        // task 387 out of `in_review` 1.5 seconds after finishing, whatever it decided,
        // and it is half of the `in_review → ready` churn (the other half is the
        // Coordinator rewind). The manifest attribution below still runs, so the run's
        // evidence lands on its slot exactly as before.
        const isRoleRun = isRoleAttributedRun(execution.payload);
        // A run a MANAGED board admitted on an AUTHORITY rather than a role — a person
        // directing execution from a surface that cannot see the board type, or platform
        // machinery (compile, security audit, validation, CI auto-fix) that performs no
        // role at all. Letting those run is the point; letting them ADVANCE the ticket
        // would be the hole, because a managed stage may only move on a recorded verdict
        // from a role accountable for it. The dispatcher stamps the marker at the single
        // point that knows the board is managed (`markLifecycleNeutral`), so this hold
        // costs nothing on an unmanaged board — no run there is ever marked.
        const isNeutralRun = isLifecycleNeutralRun(execution.payload);
        // All four classes run against an already-open ticket and hold its lane.
        const holdsLane = isReviewRun || isIncidentTriageRun || isRoleRun || isNeutralRun;
        const effectContext = {
          tenantId, taskId: Number(execution.taskId), projectId, executionId: Number(saved.id),
        };
        // Holding the lane and coordinating the lifecycle are separate decisions.
        // Role-attributed runs must not take the legacy RUNNING→in_progress /
        // COMPLETED→next-lane path, but their terminal event MUST reach the managed
        // callback: that callback first persists the role's evidence/verdict, then
        // immediately evaluates whether the stage can advance. Suppressing it here
        // left completed role work waiting for the periodic manager sweep (observed as
        // a 108-minute developer→reviewer hand-off gap on task 1377).
        // A neutral run is excluded here too, and for the same reason it holds the lane:
        // it carries no role evidence for the coordinator to persist, so the only thing
        // its terminal event could do there is trigger a stage transition it has no
        // standing to cause. A ROLE run still reaches the coordinator — that is what
        // stops completed role work waiting for the periodic sweep.
        const mayCoordinateManagedLifecycle = !isReviewRun && !isIncidentTriageRun && !isNeutralRun;
        const managedResult = mayCoordinateManagedLifecycle && this.ports.onManagedRunStatus
          && (dto.status === ExecutionStatus.RUNNING || terminal)
          ? await this.runEffect('managed_run_status', effectContext, () => this.ports.onManagedRunStatus!({
              ...effectContext,
              status: dto.status === ExecutionStatus.RUNNING ? 'running' : dto.status === ExecutionStatus.COMPLETED ? 'completed' : 'failed',
              fromStatus, actAsRole: parseActAsRole(execution.payload) ?? null,
              laneServed: parseLaneKey(execution.payload) ?? fromStatus,
            }), { managed: false, toStatus: fromStatus })
          : undefined;
        const coordinatorOwnsTransition = managedResult?.managed === true;
        if (coordinatorOwnsTransition) toStatus = managedResult.toStatus;

        if (!coordinatorOwnsTransition && !holdsLane && dto.status === ExecutionStatus.RUNNING && fromStatus !== TaskStatus.IN_PROGRESS) {
          // The board decides which lane "work is happening" IS — see
          // {@link RuntimePorts.resolveRunningStatus}. Falls back to the legacy constant only when no
          // resolver is wired (tests, a non-board task), and a null verdict means the
          // ticket stays put rather than being written to a lane the board does not have.
          const runningKey = this.ports.resolveRunningStatus
            ? await this.runEffect(
                'resolve_running_status',
                effectContext,
                () => this.ports.resolveRunningStatus!({
                  projectId, fromStatus, dispatchedLaneKey: parseLaneKey(execution.payload) ?? null,
                }),
                null,
              )
            : TaskStatus.IN_PROGRESS;
          if (runningKey) {
            toStatus = runningKey;
            await this.runEffect(
              'task_status_running',
              effectContext,
              () => this.tasks.update(task.update({ status: runningKey })),
              task,
            );
          }
        }
        if (!coordinatorOwnsTransition && !holdsLane && dto.status === ExecutionStatus.COMPLETED) {
          const resultText = dto.result ?? '';
          // Default advance is the board's NEXT swimlane by configured order — so a
          // custom board (renamed / re-ordered lanes) flows correctly instead of
          // always jumping to in_review. Falls back to in_review when there is no
          // board / the lane can't be resolved (a non-board task). A governance
          // token still short-circuits straight to Done.
          let newStatus: string = TaskStatus.IN_REVIEW;
          if (resultText.includes('[auto-approve]')) {
            newStatus = TaskStatus.DONE;
          } else {
            const nextKey = this.ports.resolveNextStatus
              ? await this.runEffect(
                  'resolve_next_status',
                  effectContext,
                  () => this.ports.resolveNextStatus!({ projectId, fromStatus }),
                  null,
                )
              : null;
            if (nextKey) newStatus = nextKey;
          }
          toStatus = newStatus;
          await this.runEffect(
            'task_status_completed',
            effectContext,
            () => this.tasks.update(task.update({ status: newStatus })),
            task,
          );
        }

        if (this.ports.onTaskStatusSync) {
          await this.runEffect(
            'task_status_sync',
            effectContext,
            () => this.ports.onTaskStatusSync!({
              tenantId, taskId: Number(execution.taskId), projectId, fromStatus, toStatus, terminal,
              // WHO moved it: the agent this execution ran as. A cloud run carries its
              // published/ide agent ref; an on-prem run carries its host id.
              actorAgentRef: execution.cloudAgentRef,
              actorAgentHostId: execution.agentHostId != null ? Number(execution.agentHostId) : null,
            }),
            undefined,
          );
        }

        // Manifest attribution (PRD §5.6): a terminal run records that the role it ran
        // AS participated on the ticket (linked to this execution), and — with producer
        // evidence — completes that role's manifest slot. Best-effort, never blocks.
        if (terminal && !coordinatorOwnsTransition) {
          if (this.ports.onRunFinalized) {
            await this.runEffect('run_finalized', effectContext, () => this.ports.onRunFinalized!({
              ...effectContext,
              status: dto.status === ExecutionStatus.COMPLETED ? 'completed' : 'failed',
              actAsRole: parseActAsRole(execution.payload) ?? null,
              laneServed: parseLaneKey(execution.payload) ?? fromStatus,
            }), undefined);
          }
        }

        // Autonomous chaining: this agent just advanced the ticket into a NEW
        // non-terminal lane. Fire the same lane auto-run trigger a human board-drag
        // uses so that lane's configured agent starts — parity with the PATCH path.
        // A Done lane finalizes (PR/commit) instead of staffing a fresh agent, and
        // the RUNNING→in_progress move is the lane the CURRENT run already owns, so
        // both are excluded here (the trigger also dedupes/no-ops defensively).
        if (!coordinatorOwnsTransition && !holdsLane && dto.status === ExecutionStatus.COMPLETED && toStatus !== fromStatus && toStatus !== TaskStatus.DONE) {
          if (this.ports.onLaneEntry) {
            await this.runEffect('lane_entry_dispatch', effectContext, () => this.ports.onLaneEntry!({
              tenantId, taskId: Number(execution.taskId), projectId, status: toStatus,
              originLaneKey: parseLaneKey(execution.payload),
            }), undefined);
          }
        }

        // Narrate the run's progress back into the ticket's linked Brain chats (started ▸
        // completed ▸ failed) so a dev agent's work is visible in the conversation that
        // spawned it. Skipped for a Validator review run (internal). LAST side-effect so a
        // milestone failure can't block the lane sync/chaining above; the hook is itself
        // best-effort + per-execution+phase idempotent.
        if (!isReviewRun) {
          const taskType = (task.toPlain() as { taskType?: string }).taskType;
          // `started` fires on EVERY RUNNING transition, not only when the lane flips to
          // in_progress — a re-run on a ticket already in progress and a Coordinator-managed
          // lane both start silently otherwise. The per-execution+phase idempotency key
          // (run:{id}:started) collapses repeats (heartbeat re-marks, resume) to one post.
          const phase = dto.status === ExecutionStatus.RUNNING ? 'started' as const
            : dto.status === ExecutionStatus.COMPLETED ? 'completed' as const
            : dto.status === ExecutionStatus.FAILED ? 'failed' as const : null;
          if (phase) {
            if (this.ports.onRunMilestone) {
              await this.runEffect('run_milestone', effectContext, () => this.ports.onRunMilestone!({
                tenantId, taskId: Number(execution.taskId), projectId,
                taskType: ticketKindForTaskType(taskType),
                agentRef: execution.cloudAgentRef, executionId: Number(saved.id), phase,
                toStatus, resultText: dto.result ?? null, errorMessage: dto.errorMessage ?? null,
              }), undefined);
            }
          }
        }
        movedTicket = dto.status === ExecutionStatus.COMPLETED && toStatus !== fromStatus;
      }
    } catch (error) {
      reportCaughtError(error, { source: "application/runtime/RuntimeService.ts", operation: "update", context: { logMessage: '[runtime-update] lifecycle orchestration failed outside an isolated effect', details: {
        executionId: Number(saved.id),
        tenantId: Number(execution.tenantId),
        taskId: Number(execution.taskId),
        status: dto.status,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      } } });
    }

    // A lane advance is a durable product of the run just as much as a commit or PR.
    // `finalizeCloudRun` stamps repository artifacts before this lifecycle transition;
    // complete the verdict here, after the authoritative from/to statuses are known.
    // Without this, a legitimate no-code workflow that advances a ticket is counted as
    // an empty completion and can trip the unproductive-run breaker.
    if (dto.status === ExecutionStatus.COMPLETED && movedTicket && saved.produced !== true) {
      try {
        saved = await this.executions.update(saved.markProduced(true));
      } catch (error) {
        reportCaughtError(error, {
          source: 'application/runtime/RuntimeService.ts',
          operation: 'markProducedFromLaneMove',
          context: { executionId: Number(saved.id), taskId: Number(saved.taskId) },
        });
      }
    }

    const auditType = dto.status === ExecutionStatus.RUNNING
      ? AuditEventType.EXECUTION_STARTED
      : dto.status === ExecutionStatus.COMPLETED
        ? AuditEventType.EXECUTION_COMPLETED
        : AuditEventType.EXECUTION_FAILED;

    await this.audit.save(AuditEvent.create({
      tenantId:     execution.tenantId,
      userId:       null,
      eventType:    auditType,
      resourceType: 'execution',
      resourceId:   String(saved.id),
      metadata:     dto.result ? JSON.stringify({ result: dto.result }) : null,
    }));

    // A FAILED transition is invisible on the Logs/Timeline (telemetry-only
    // views) unless it is emitted as a trace event — same gap the orphan reaper
    // closes (see reapIfOrphaned).
    if (dto.status === ExecutionStatus.FAILED) await this.ports.onTerminalFailure?.(saved);

    return saved;
  }
}
