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
import { CLOUD_ORPHAN_REASON, HOST_ORPHAN_REASON } from './orphanReasons';

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
   * Cloud ceiling is tight on purpose: Cloudflare stops `waitUntil` work shortly
   * after the HTTP response returns (observed ~30s), so a serverless cloud run
   * physically cannot make progress past that. 90s = that wall + margin for the
   * terminal-status write + clock skew, so a genuinely-dead run surfaces in ~1.5
   * min instead of the old 8 min. A self-hosted host has a real long-lived process
   * and legitimately runs much longer, so it keeps a far larger ceiling.
   * (Durable multi-step cloud execution is the planned fix — see the Consolidated
   * Gap Register's CloudRunnerDO entry; this is the interim fast-fail.)
   *
   * Read-path repair (no cron needed): the stream's reconciliation poll calls
   * `getExecution` every few seconds, so an orphan self-heals on next view.
   * Bounded — only stale, non-terminal rows incur a write; healthy reads don't.
   */
  private static readonly CLOUD_ORPHAN_MS = 90_000;
  private static readonly HOST_ORPHAN_MS = 30 * 60_000;

  private isCloudRun(e: Execution): boolean {
    return e.agentHostId == null;
  }

  private isOrphaned(e: Execution, nowMs: number): boolean {
    const live = e.status === ExecutionStatus.PENDING
      || e.status === ExecutionStatus.SUBMITTED
      || e.status === ExecutionStatus.RUNNING;
    if (!live) return false;
    const sinceMs = (e.startedAt ?? e.updatedAt ?? e.createdAt).getTime();
    const ceiling = this.isCloudRun(e)
      ? RuntimeService.CLOUD_ORPHAN_MS
      : RuntimeService.HOST_ORPHAN_MS;
    return nowMs - sinceMs > ceiling;
  }

  /** Actionable reason for a reaped run — cloud runs hit the serverless wall and
   *  need a durable runtime; host runs lost their process/connection. */
  private orphanReason(e: Execution): string {
    return this.isCloudRun(e) ? CLOUD_ORPHAN_REASON : HOST_ORPHAN_REASON;
  }

  private async reapIfOrphaned(e: Execution): Promise<Execution> {
    if (!this.isOrphaned(e, Date.now())) return e;
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
    try {
      const task = await this.tasks.findById(execution.taskId);
      if (task) {
        if (dto.status === ExecutionStatus.RUNNING && task.status !== TaskStatus.IN_PROGRESS) {
          await this.tasks.update(task.update({ status: TaskStatus.IN_PROGRESS }));
        }
        if (dto.status === ExecutionStatus.COMPLETED) {
          // default move to in_review; some governance rules may auto-complete
          let newStatus: TaskStatus = TaskStatus.IN_REVIEW;
          const resultText = dto.result ?? '';
          // simple governance rule: include token [auto-approve] to skip review
          if (resultText.includes('[auto-approve]')) {
            newStatus = TaskStatus.DONE;
          }
          await this.tasks.update(task.update({ status: newStatus }));
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
