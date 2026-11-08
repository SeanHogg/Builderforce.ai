import { reportCaughtError } from '../observability/caughtErrorReporter';
import { applyLandedLifecycle, landedRunOf, recordLandedAudit, settleLandedFailures, type LandedOutcome, type LandedRun } from './executionLandedEffects';
import { IExecutionRepository } from '../../domain/execution/IExecutionRepository';
import { persistTransition } from './executionLanding';
import { stampProducedFromLaneMove } from './stampProducedFromLaneMove';
import type { RunTally } from '@builderforce/agent-run';
import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IAgentRepository } from '../../domain/agent/IAgentRepository';
import { IAuditRepository } from '../../domain/audit/IAuditRepository';
import { Execution } from '../../domain/execution/Execution';
import { AuditEvent } from '../../domain/audit/AuditEvent';
import {
  AuditEventType, ExecutionStatus,
  asExecutionId, asTaskId, asAgentId, asAgentHostId, asTenantId,
} from '../../domain/shared/types';
import { NotFoundError, ForbiddenError, ServiceUnavailableError } from '../../domain/shared/errors';
import {
  cloudOrphanReason, cloudSilenceCeilingMs, HOST_ORPHAN_REASON,
  PAUSED_DEADLINE_MS, PAUSED_ORPHAN_REASON,
} from './orphanReasons';
import { parseExecutor, parseCloudAgentRef, stripAdmissionStamps } from './cloudDispatch';
import { ADMISSION_CANCEL_ACTOR } from './admissionActor';
import { isSubagentRun } from './cloudChildRuns';
import { ticketKindForTaskType } from '../brain/ChatTicketService';
import type { RuntimePorts, RuntimeServiceOptions } from './ports';
import { coercePolicyGates } from '@builderforce/agent-tools';
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
  /** The run's final tally (`RunState.telemetry`), handed to the one outcome-row writer when this update LANDS the run. */
  telemetry?: RunTally;
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
   * The fan-out for runs FAILED by a set-based write that bypasses {@link update} (the stale-run reaper's
   * guarded batch UPDATE): lifecycle effects (task sync, managed callback, attribution, chat milestone)
   * and the audit event, exactly as {@link update} fires them. Best-effort; never throws.
   */
  async settleLandedFailures(runs: ReadonlyArray<LandedRun & { errorMessage: string | null }>): Promise<void> {
    await settleLandedFailures({ tasks: this.tasks, audit: this.audit, ports: this.ports }, runs);
  }

  /**
   * Stamp the effective governance gates onto a dispatch payload. Returns the
   * payload unchanged when nothing resolves or when the resolver is unwired. A
   * wired resolver that fails is fail-closed: an agent run must not start without
   * knowing which governance policy applies.
   * the caller ALREADY carried gates (a `deploy()`-and-dispatch run compiles its
   * own onto the spec): those are merged AFTER the tenant's and can only add to them.
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
      // The tenant's gates are ALWAYS resolved. Gates already on the payload (a sub-agent child inheriting its parent's, a
      // `deploy()` run compiling its own onto the spec) can only ADD restrictions: they are merged after the tenant's and
      // never replace or drop one (an id the tenant already holds keeps the tenant's gate).
      const gates = await this.ports.resolvePolicyGates({
        tenantId, projectId, agentRef: parseCloudAgentRef(payload) ?? null,
      });
      const supplied = Array.isArray(obj.policyGates) ? coercePolicyGates(obj.policyGates) : [];
      const tenantIds = new Set(gates.map((g) => g.id));
      const merged = [...gates, ...supplied.filter((g) => !tenantIds.has(g.id))];
      if (merged.length === 0) return payload;
      // ALWAYS the compact form: it is what the cloud engines enforce (a class gate also catches MCP, builtin and connector
      // tools). A host that predates class gates is handed them spelled out per tool where the frame is sent to it (the host relay).
      obj.policyGates = merged;
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
    // A sub-agent speaks to the chat through its own report, never as a run milestone.
    if (isSubagentRun(execution.payload)) return;
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
    const payload = await this.withPolicyGates(stripAdmissionStamps(dto.payload), dto.tenantId, projectId);

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

  /** `slim` skips the `result` blob — liveness/breaker readers (auto-run evaluator, dispatch
   *  gate, lane gate) never read it. History is bounded per ticket (see ExecutionRepository). */
  async listByTask(taskId: number, opts: { slim?: boolean } = {}): Promise<Execution[]> {
    const list = await this.executions.findByTask(asTaskId(taskId), opts);
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
      { slim: true },
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
      const { won, execution: saved } = await persistTransition(this.executions, failed);
      if (!won) return saved; // lost the race to another terminal transition: the winner owns the side effects
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
      // …and the SAME lifecycle fan-out update() owes a FAILED run (task sync, managed callback,
      // attribution, and the chat milestone: a human driving the conversation must hear the run died,
      // not just watch the board stop moving). Idempotent (run:{id}:failed), so racing the cron
      // reaper's own fan-out is harmless.
      await applyLandedLifecycle(
        { tasks: this.tasks, audit: this.audit, ports: this.ports },
        landedRunOf(saved),
        { status: ExecutionStatus.FAILED, errorMessage: this.orphanReason(e) },
      );
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

  /** `opts.telemetry`: the run's final tally when the canceller is the run itself (a steered stop), so the cancel's outcome row carries its counts. */
  async cancel(id: number, cancelledBy: string, opts: { telemetry?: RunTally } = {}): Promise<Execution> {
    const execution = await this.getExecution(id);
    const cancelled = execution.cancel();
    const { won, execution: saved } = await persistTransition(this.executions, cancelled, opts.telemetry);
    if (!won) return saved; // a cancel that lost to a completion does nothing: no signal, no audit, no milestone
    // Right after the row flips, so a durable runner mid-step stops on its next cancel poll.
    await this.ports.onCancelled?.(saved).catch((error) => reportCaughtError(error, { source: "application/runtime/RuntimeService.ts", operation: "cancel", context: { logMessage: '[runtime] cancel signal to the cloud runner failed', details: { executionId: saved.id } } }));

    await this.audit.save(AuditEvent.create({
      tenantId:     execution.tenantId,
      userId:       cancelledBy,
      eventType:    AuditEventType.TASK_CANCELLED,
      resourceType: 'execution',
      resourceId:   String(saved.id),
      metadata:     null,
    }));

    // Narrate the cancellation into the ticket's linked chats. update() has no CANCELLED transition (its
    // lane sync, managed callback, attribution and failure telemetry are all keyed on running / completed /
    // failed), so cancel's own effects - runner signal, audit, this milestone - are the complete set.
    // A run refused by admission never started: there is nothing to narrate to the ticket's chats (the refusal is on its timeline).
    if (cancelledBy !== ADMISSION_CANCEL_ACTOR) await this.postLifecycleMilestone(saved, 'cancelled');

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

    const landed = await persistTransition(this.executions, execution, dto.telemetry);
    if (!landed.won) return landed.execution; // another writer already landed it: its side effects stand
    let saved = landed.execution;
    // The switch above admitted exactly these three.
    const outcomeStatus = dto.status as LandedOutcome['status'];
    // The lifecycle fan-out (task-lane sync, ticket metrics, managed-board callback, manifest
    // attribution, next-lane trigger, chat milestone) is shared with every other writer that
    // lands a status: see executionLandedEffects.
    const { movedTicket } = await applyLandedLifecycle(
      { tasks: this.tasks, audit: this.audit, ports: this.ports },
      landedRunOf(execution),
      { status: outcomeStatus, result: dto.result, errorMessage: dto.errorMessage },
    );

    // A lane advance is a durable product of the run (see `stampProducedFromLaneMove`).
    if (dto.status === ExecutionStatus.COMPLETED && movedTicket) saved = await stampProducedFromLaneMove(this.executions, saved);

    await recordLandedAudit(this.audit, landedRunOf(saved), outcomeStatus, dto.result ? JSON.stringify({ result: dto.result }) : null);

    // A FAILED transition is invisible on the Logs/Timeline (telemetry-only
    // views) unless it is emitted as a trace event — same gap the orphan reaper
    // closes (see reapIfOrphaned).
    if (dto.status === ExecutionStatus.FAILED) await this.ports.onTerminalFailure?.(saved);

    return saved;
  }
}
