import { IExecutionRepository } from '../../domain/execution/IExecutionRepository';
import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IAgentRepository } from '../../domain/agent/IAgentRepository';
import { IAuditRepository } from '../../domain/audit/IAuditRepository';
import { Execution } from '../../domain/execution/Execution';
import { AuditEvent } from '../../domain/audit/AuditEvent';
import {
  AuditEventType, ExecutionStatus,
  asExecutionId, asTaskId, asAgentId, asClawId, asTenantId,
} from '../../domain/shared/types';
import { NotFoundError, ForbiddenError } from '../../domain/shared/errors';

export interface SubmitTaskDto {
  taskId:      number;
  agentId?:    number;
  clawId?:     number | null;
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
        clawId:      dto.clawId != null ? asClawId(dto.clawId) : null,
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
        clawId: dto.clawId ?? null,
        sessionId: dto.sessionId ?? null,
      }),
    }));

    return execution;
  }

  async getExecution(id: number): Promise<Execution> {
    const e = await this.executions.findById(asExecutionId(id));
    if (!e) throw new NotFoundError('Execution', id);
    return e;
  }

  async listByTask(taskId: number): Promise<Execution[]> {
    return this.executions.findByTask(asTaskId(taskId));
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

    return saved;
  }
}
