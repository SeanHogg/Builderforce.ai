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
import { cloudOrphanReason, cloudSilenceCeilingMs, HOST_ORPHAN_REASON } from './orphanReasons';
import { parseExecutor } from './cloudDispatch';

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
  ) {}

  async submit(dto: SubmitTaskDto): Promise<Execution> {
    const task = await this.tasks.findById(asTaskId(dto.taskId));
    if (!task) throw new NotFoundError('Task', dto.taskId);

    if (dto.agentId !== undefined) {
      const agent = await this.agents.findById(asAgentId(dto.agentId));
      if (!agent) throw new NotFoundError('Agent', dto.agentId);
      if (!agent.isActive) throw new ForbiddenError('Agent is not active');
    }

    const execution = await this.executions.save(
      Execution.create({
        taskId:      asTaskId(dto.taskId),
        agentId:     dto.agentId != null ? asAgentId(dto.agentId) : null,
        agentHostId:      dto.agentHostId != null ? asAgentHostId(dto.agentHostId) : null,
        tenantId:    asTenantId(dto.tenantId),
        submittedBy: dto.submittedBy,
        sessionId:   dto.sessionId ?? null,
        payload:     dto.payload ?? null,
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

  /**
   * Cloud runs execute in a `waitUntil` background task; if that isolate is
   * evicted (or an update throws) before writing a terminal status, the row is
   * left non-terminal and the UI polls "running" forever even though nothing is
   * executing — the "says completed but still running" symptom. There is no live
   * process to recover, so once a run exceeds a per-kind ceiling we mark it failed
   * on read.
   *
   * Cloud ceiling is PER-SURFACE ({@link cloudSilenceCeilingMs}, keyed off the executor
   * stamped on the payload at dispatch): the interim Worker loop runs in `waitUntil`,
   * which Cloudflare stops shortly after the HTTP response returns (observed ~30s), so
   * it keeps the tight 90s wall + margin — a genuinely-dead serverless run surfaces in
   * ~1.5 min. A long-lived executor (durable CloudRunnerDO / Cloudflare Container)
   * heartbeats `updatedAt` once per alarm tick, and a tick legitimately spans one slow
   * LLM step (60-90s+), so it gets the larger long-lived ceiling — measured from last
   * activity below — and only a SILENT (crashed/hung) long-lived run is reaped;
   * {@link orphanReason} then reports it as a crash, not a 30s timeout. A self-hosted
   * host has a real long-lived process and keeps a far larger ceiling still.
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

        if (dto.status === ExecutionStatus.RUNNING && fromStatus !== TaskStatus.IN_PROGRESS) {
          toStatus = TaskStatus.IN_PROGRESS;
          await this.tasks.update(task.update({ status: TaskStatus.IN_PROGRESS }));
        }
        if (dto.status === ExecutionStatus.COMPLETED) {
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

        // Autonomous chaining: this agent just advanced the ticket into a NEW
        // non-terminal lane. Fire the same lane auto-run trigger a human board-drag
        // uses so that lane's configured agent starts — parity with the PATCH path.
        // A Done lane finalizes (PR/commit) instead of staffing a fresh agent, and
        // the RUNNING→in_progress move is the lane the CURRENT run already owns, so
        // both are excluded here (the trigger also dedupes/no-ops defensively).
        if (dto.status === ExecutionStatus.COMPLETED && toStatus !== fromStatus && toStatus !== TaskStatus.DONE) {
          await this.onLaneEntry?.({
            tenantId, taskId: Number(execution.taskId), projectId, status: toStatus,
            originLaneKey: parseLaneKey(execution.payload),
          });
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
