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
import { NotFoundError, ForbiddenError } from '../../domain/shared/errors';
import {
  cloudOrphanReason, cloudSilenceCeilingMs, HOST_ORPHAN_REASON,
  PAUSED_DEADLINE_MS, PAUSED_ORPHAN_REASON,
} from './orphanReasons';
import { parseExecutor, parseActAsRole, parseCloudAgentRef } from './cloudDispatch';
import type { PolicyGate } from '@builderforce/agent-tools';
import { ticketKindForTaskType, type RunMilestonePhase } from '../brain/ChatTicketService';

export interface SubmitTaskDto {
  taskId:      number;
  agentId?:    number;
  agentHostId?:     number | null;
  tenantId:    number;
  submittedBy: string;
  sessionId?:  string | null;
  payload?:    string;
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
  static readonly NON_TERMINAL_STATUSES: ExecutionStatus[] = [
    ExecutionStatus.PENDING,
    ExecutionStatus.SUBMITTED,
    ExecutionStatus.RUNNING,
    ExecutionStatus.PAUSED,
  ];

  constructor(
    private readonly executions: IExecutionRepository,
    private readonly tasks:      ITaskRepository,
    private readonly agents:     IAgentRepository,
    private readonly audit:      IAuditRepository,
    /**
     * Optional sink invoked whenever an execution terminally fails (in-loop
     * FAILED transition or orphan-reap). Wired to write a `run.failed` tool-audit
     * event so the failure surfaces on the Observability Logs + Timeline, which
     * are derived only from tool-audit telemetry. Best-effort by contract.
     */
    private readonly onTerminalFailure?: (e: Execution) => Promise<void>,
    /**
     * Optional sink invoked whenever an execution syncs its task's status (an
     * agent moving a ticket through lanes) or reaches a terminal state. Wired to
     * the ticket-metrics layer ({@link syncExecutionTaskLifecycle}) so agent lane
     * moves record transitions exactly like a human PATCH and a terminal run
     * stamps the work-stopped signal. Best-effort by contract.
     */
    private readonly onTaskStatusSync?: (info: {
      tenantId: number; taskId: number; projectId: number;
      fromStatus: string; toStatus: string; terminal: boolean;
    }) => Promise<void>,
    /**
     * Optional cloud-orphan self-heal. Invoked for a stale CLOUD run BEFORE it is
     * failed, so a crashed/evicted run is re-queued once on the durable executor
     * instead of being permanently failed by whichever reader noticed it first
     * (the read path used to defeat the cron's self-heal by failing first). Returns
     * `'requeued'` when it recovered the run (left running) or `'failed'` to let the
     * normal orphan-fail proceed. Wired to {@link ./cloudSelfHeal} with env+db at the
     * composition root. Idempotent + once-only by contract.
     */
    private readonly onCloudOrphan?: (e: Execution) => Promise<'requeued' | 'failed'>,
    /**
     * Optional autonomous-trigger sink invoked when an execution ADVANCES its
     * ticket into a new non-terminal lane (e.g. an agent completes → ticket moves
     * to in_review). Wired at the composition root to the SAME lane auto-run
     * trigger a human board-drag uses ({@link maybeAutoRunOnLaneEntry}), so the
     * next lane's configured cloud agent kicks off after an agent finishes — the
     * agent-moved path previously wrote `tasks.status` directly here and bypassed
     * the PATCH-route trigger, so the next agent never started. The trigger itself
     * is idempotent (dedupes on a live execution) and no-ops on a Done lane.
     * Best-effort by contract.
     */
    private readonly onLaneEntry?: (info: {
      tenantId: number; taskId: number; projectId: number; status: string;
      /** The lane the just-completed run was dispatched FOR (stamped in its payload
       *  by the auto-run trigger). Lets the trigger skip a same-lane re-entry loop
       *  WITHOUT blocking a genuine handoff to a different lane staffed by the same
       *  agent. Absent for manual / human-drag runs. */
      originLaneKey?: string;
    }) => Promise<void>,
    /**
     * Optional resolver for the board's NEXT swimlane by configured order — used to
     * advance a ticket on COMPLETED to whatever lane the board defines after the
     * current one, instead of a hardcoded `in_review`. Wired at the composition root
     * to {@link resolveNextTaskStatus} (reads the project board's `swimlanes` by
     * `position`). Returns null for a non-board task or an unresolvable lane, so the
     * default (in_review) still applies. Best-effort by contract.
     */
    private readonly resolveNextStatus?: (info: {
      projectId: number; fromStatus: string;
    }) => Promise<string | null>,
    /**
     * Optional run-milestone sink invoked when an execution STARTS (running), COMPLETES,
     * or FAILS — so a cloud-agent run narrates its progress back into every Brain chat the
     * ticket is linked to (the runtime's chat-awareness hook). Wired at the composition
     * root to {@link ChatTicketService.postRunMilestone}, which fans out to the linked
     * chats and is per-execution+phase idempotent. Best-effort by contract: it is called
     * AFTER the lane sync + autonomous-chaining side-effects and must never block them.
     */
    private readonly onRunMilestone?: (info: {
      tenantId: number; taskId: number; projectId: number; taskType: string;
      agentRef: string | null; executionId: number;
      phase: RunMilestonePhase;
      toStatus?: string | null; resultText?: string | null; errorMessage?: string | null;
      /** The `ask_human` question (paused phase) so the chat shows WHAT the agent needs. */
      questionText?: string | null;
      /** Uniquifies repeatable phases (paused/resumed once per question cycle) in the
       *  idempotency key — the approval id at the ask_human/answer sites. */
      eventNonce?: string | null;
    }) => Promise<void>,
    /**
     * Optional attribution sink invoked when a run reaches a TERMINAL status — so the
     * Coordinated Role Participation manifest can record that "role X participated"
     * (linked to the execution it ran as) and mark it completed when evidence lands.
     * Wired at the composition root to the manifest attribution handler. Best-effort:
     * called after all lane/metrics side-effects and must never block them.
     */
    private readonly onRunFinalized?: (info: {
      tenantId: number; taskId: number; projectId: number; executionId: number;
      status: 'completed' | 'failed'; actAsRole: string | null; laneServed: string | null;
    }) => Promise<void>,
    /** Managed-board coordination seam. When it returns managed=true, the
     * Coordinator owns every task-status transition for this execution and the
     * legacy RuntimeService lane writer is bypassed. */
    private readonly onManagedRunStatus?: (info: {
      tenantId: number; taskId: number; projectId: number; executionId: number;
      status: 'running' | 'completed' | 'failed'; fromStatus: string;
      actAsRole: string | null; laneServed: string | null;
    }) => Promise<{ managed: boolean; toStatus: string }>,
    /**
     * Governance-gate resolver. `submit` is the ONE funnel every execution passes
     * through — board auto-run, a manual dispatch, an agent handoff, the workflow
     * relay — so stamping the tenant's effective {@link PolicyGate}s onto the
     * payload HERE is what makes an authored policy pack reach the engine's
     * `evaluatePolicyGate` seam on every real run, without each dispatch call site
     * remembering to resolve them. Wired at the composition root to
     * {@link resolvePolicyGates} (read-through cached). Best-effort by contract:
     * a resolver failure must never block a dispatch — it degrades to today's
     * ungated behaviour, exactly as if no pack were authored.
     */
    private readonly resolvePolicyGates?: (scope: {
      tenantId: number; projectId: number | null; agentRef: string | null;
    }) => Promise<PolicyGate[]>,
  ) {}

  /**
   * Stamp the effective governance gates onto a dispatch payload. Returns the
   * payload unchanged when nothing resolves, when the resolver is unwired, or when
   * the caller ALREADY carried gates (a `deploy()`-and-dispatch run compiles its
   * own onto the spec — the explicit spec wins over the ambient tenant policy).
   */
  private async withPolicyGates(
    payload: string | undefined,
    tenantId: number,
    projectId: number | null,
  ): Promise<string | undefined> {
    if (!this.resolvePolicyGates) return payload;
    try {
      let obj: Record<string, unknown> = {};
      if (payload) {
        try { obj = JSON.parse(payload) as Record<string, unknown>; } catch { obj = {}; }
      }
      if (Array.isArray(obj.policyGates) && obj.policyGates.length > 0) return payload;

      const gates = await this.resolvePolicyGates({
        tenantId, projectId, agentRef: parseCloudAgentRef(payload) ?? null,
      });
      if (gates.length === 0) return payload;
      obj.policyGates = gates;
      return JSON.stringify(obj);
    } catch {
      return payload; // never block a dispatch on governance resolution
    }
  }

  /**
   * Post a lifecycle milestone for an execution whose row is written DIRECTLY —
   * bypassing {@link update}'s milestone emission: the ask_human pause + resume in
   * `CloudRunnerDO`, {@link cancel}, and the orphan reap ({@link reapIfOrphaned}).
   * Resolves the ticket + project the same way `update` does, then fans out via
   * {@link onRunMilestone}. Best-effort — never throws (chat narration must never
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
      await this.onRunMilestone?.({
        tenantId: execution.tenantId, taskId: Number(execution.taskId),
        projectId: plain.projectId ?? 0, taskType: ticketKindForTaskType(plain.taskType),
        agentRef: execution.cloudAgentRef, executionId: Number(execution.id), phase,
        errorMessage: opts?.errorMessage ?? null,
        questionText: opts?.questionText ?? null,
        eventNonce: opts?.eventNonce ?? null,
      });
    } catch { /* best-effort: never block the direct write */ }
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
    } catch { /* best-effort */ }
  }

  async submit(dto: SubmitTaskDto): Promise<Execution> {
    const task = await this.tasks.findById(asTaskId(dto.taskId));
    if (!task) throw new NotFoundError('Task', dto.taskId);

    if (dto.agentId !== undefined) {
      const agent = await this.agents.findById(asAgentId(dto.agentId));
      if (!agent) throw new NotFoundError('Agent', dto.agentId);
      if (!agent.isActive) throw new ForbiddenError('Agent is not active');
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
        agentHostId:      dto.agentHostId != null ? asAgentHostId(dto.agentHostId) : null,
        tenantId:    asTenantId(dto.tenantId),
        submittedBy: dto.submittedBy,
        sessionId:   dto.sessionId ?? null,
        payload:     payload ?? null,
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
        agentHostId: dto.agentHostId ?? null,
        sessionId: dto.sessionId ?? null,
      }),
    }));

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
    if (this.isCloudRun(e) && this.onCloudOrphan) {
      try {
        if ((await this.onCloudOrphan(e)) === 'requeued') {
          return (await this.executions.findById(asExecutionId(e.id))) ?? e;
        }
      } catch { /* fall through to fail */ }
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
      await this.onTerminalFailure?.(saved);
      // …and into the ticket's linked Brain chats: a human driving the conversation
      // must hear that the run died, not just watch the board stop moving. Idempotent
      // (run:{id}:failed), so racing the cron reaper's own narration is harmless.
      await this.postLifecycleMilestone(saved, 'failed', { errorMessage: this.orphanReason(e) });
      return saved;
    } catch {
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

    const saved = await this.executions.update(execution);

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
        // Both classes run against an already-open ticket and hold its lane.
        const holdsLane = isReviewRun || isIncidentTriageRun;
        const managedResult = !holdsLane && (dto.status === ExecutionStatus.RUNNING || terminal)
          ? await this.onManagedRunStatus?.({
              tenantId, taskId: Number(execution.taskId), projectId, executionId: Number(saved.id),
              status: dto.status === ExecutionStatus.RUNNING ? 'running' : dto.status === ExecutionStatus.COMPLETED ? 'completed' : 'failed',
              fromStatus, actAsRole: parseActAsRole(execution.payload) ?? null,
              laneServed: parseLaneKey(execution.payload) ?? fromStatus,
            }).catch(() => ({ managed: false, toStatus: fromStatus }))
          : undefined;
        const coordinatorOwnsTransition = managedResult?.managed === true;
        if (coordinatorOwnsTransition) toStatus = managedResult.toStatus;

        if (!coordinatorOwnsTransition && !holdsLane && dto.status === ExecutionStatus.RUNNING && fromStatus !== TaskStatus.IN_PROGRESS) {
          toStatus = TaskStatus.IN_PROGRESS;
          await this.tasks.update(task.update({ status: TaskStatus.IN_PROGRESS }));
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
            const nextKey = await this.resolveNextStatus?.({ projectId, fromStatus }).catch(() => null);
            if (nextKey) newStatus = nextKey;
          }
          toStatus = newStatus;
          await this.tasks.update(task.update({ status: newStatus }));
        }

        await this.onTaskStatusSync?.({ tenantId, taskId: Number(execution.taskId), projectId, fromStatus, toStatus, terminal });

        // Manifest attribution (PRD §5.6): a terminal run records that the role it ran
        // AS participated on the ticket (linked to this execution), and — with producer
        // evidence — completes that role's manifest slot. Best-effort, never blocks.
        if (terminal && !coordinatorOwnsTransition) {
          await this.onRunFinalized?.({
            tenantId, taskId: Number(execution.taskId), projectId, executionId: Number(saved.id),
            status: dto.status === ExecutionStatus.COMPLETED ? 'completed' : 'failed',
            actAsRole: parseActAsRole(execution.payload) ?? null,
            laneServed: parseLaneKey(execution.payload) ?? fromStatus,
          }).catch(() => {});
        }

        // Autonomous chaining: this agent just advanced the ticket into a NEW
        // non-terminal lane. Fire the same lane auto-run trigger a human board-drag
        // uses so that lane's configured agent starts — parity with the PATCH path.
        // A Done lane finalizes (PR/commit) instead of staffing a fresh agent, and
        // the RUNNING→in_progress move is the lane the CURRENT run already owns, so
        // both are excluded here (the trigger also dedupes/no-ops defensively).
        if (!coordinatorOwnsTransition && !holdsLane && dto.status === ExecutionStatus.COMPLETED && toStatus !== fromStatus && toStatus !== TaskStatus.DONE) {
          await this.onLaneEntry?.({
            tenantId, taskId: Number(execution.taskId), projectId, status: toStatus,
            originLaneKey: parseLaneKey(execution.payload),
          });
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
            await this.onRunMilestone?.({
              tenantId, taskId: Number(execution.taskId), projectId,
              taskType: ticketKindForTaskType(taskType),
              agentRef: execution.cloudAgentRef, executionId: Number(saved.id), phase,
              toStatus, resultText: dto.result ?? null, errorMessage: dto.errorMessage ?? null,
            });
          }
        }
      }
    } catch {
      // ignore task sync errors to avoid blocking runtime flow
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
    if (dto.status === ExecutionStatus.FAILED) await this.onTerminalFailure?.(saved);

    return saved;
  }
}
