import { and, desc, eq, inArray } from 'drizzle-orm';
import { IExecutionRepository } from '../../domain/execution/IExecutionRepository';
import { Execution, ExecutionProps } from '../../domain/execution/Execution';
import {
  ExecutionId, TaskId, TenantId, AgentId, AgentHostId, ExecutionStatus,
  asExecutionId, asTaskId, asTenantId, asAgentId, asAgentHostId,
} from '../../domain/shared/types';
import { executions as executionsTable } from '../database/schema';
import type { Db } from '../database/connection';

export class ExecutionRepository implements IExecutionRepository {
  constructor(private readonly db: Db) {}

  async findById(id: ExecutionId): Promise<Execution | null> {
    const [row] = await this.db
      .select().from(executionsTable)
      .where(eq(executionsTable.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  async findByTask(taskId: TaskId): Promise<Execution[]> {
    const rows = await this.db
      .select().from(executionsTable)
      .where(eq(executionsTable.taskId, taskId))
      .orderBy(desc(executionsTable.createdAt));
    return rows.map(toDomain);
  }

  async findByTasksAndStatuses(taskIds: TaskId[], statuses: ExecutionStatus[]): Promise<Execution[]> {
    if (taskIds.length === 0 || statuses.length === 0) return [];
    const rows = await this.db
      .select().from(executionsTable)
      .where(and(
        inArray(executionsTable.taskId, taskIds),
        inArray(executionsTable.status, statuses),
      ))
      .orderBy(desc(executionsTable.createdAt));
    return rows.map(toDomain);
  }

  async findByTenant(tenantId: TenantId, limit = 50): Promise<Execution[]> {
    const rows = await this.db
      .select().from(executionsTable)
      .where(eq(executionsTable.tenantId, tenantId))
      .orderBy(desc(executionsTable.createdAt))
      .limit(limit);
    return rows.map(toDomain);
  }

  async findBySession(tenantId: TenantId, sessionId: string, limit = 200): Promise<Execution[]> {
    const rows = await this.db
      .select().from(executionsTable)
      .where(
        and(
          eq(executionsTable.tenantId, tenantId),
          eq(executionsTable.sessionId, sessionId),
        ),
      )
      .orderBy(desc(executionsTable.createdAt))
      .limit(limit);
    return rows.map(toDomain);
  }

  async save(execution: Execution): Promise<Execution> {
    const plain = execution.toPlain();
    const [inserted] = await this.db
      .insert(executionsTable)
      .values({
        taskId:      plain.taskId,
        agentId:     plain.agentId ?? undefined,
        agentRegistrationId: plain.agentRegistrationId ?? undefined,
        agentHostId:      plain.agentHostId ?? undefined,
        tenantId:    plain.tenantId,
        submittedBy: plain.submittedBy,
        sessionId:   plain.sessionId ?? undefined,
        status:      plain.status,
        payload:     plain.payload ?? undefined,
      })
      .returning();
    if (!inserted) throw new Error('Execution insert returned no rows');
    return toDomain(inserted);
  }

  async update(execution: Execution): Promise<Execution> {
    const plain = execution.toPlain();
    const [updated] = await this.db
      .update(executionsTable)
      .set({
        status:       plain.status,
        result:       plain.result ?? undefined,
        errorMessage: plain.errorMessage ?? undefined,
        // The productivity verdict (0385) must actually LAND. Without this column in the
        // set, `markProduced(true)` round-trips through the domain, writes everything
        // except the one field it exists for, and `toDomain(updated)` reads the unchanged
        // value straight back — a silent no-op that leaves the lane-move signal dead and
        // lets a legitimate no-code ticket be judged an empty completion.
        //
        // `?? undefined` is load-bearing: drizzle omits an undefined key, so a `null`
        // (not judged) can never overwrite a verdict `finalizeCloudRun` already wrote,
        // while `false` — a real "this run shipped nothing" — is persisted.
        produced:     plain.produced ?? undefined,
        startedAt:    plain.startedAt ?? undefined,
        completedAt:  plain.completedAt ?? undefined,
        updatedAt:    new Date(),
      })
      .where(eq(executionsTable.id, plain.id))
      .returning();
    if (!updated) throw new Error('Execution update returned no rows');
    return toDomain(updated);
  }
}

function toDomain(row: typeof executionsTable.$inferSelect): Execution {
  return Execution.reconstitute({
    id:           asExecutionId(row.id),
    taskId:       asTaskId(row.taskId),
    agentId:      row.agentId != null ? asAgentId(row.agentId) : null,
    agentRegistrationId: row.agentRegistrationId ?? null,
    agentHostId:       row.agentHostId != null ? asAgentHostId(row.agentHostId) : null,
    tenantId:     asTenantId(row.tenantId),
    submittedBy:  row.submittedBy,
    sessionId:    row.sessionId ?? null,
    status:       row.status as ExecutionStatus,
    payload:      row.payload ?? null,
    cloudAgentRef: row.cloudAgentRef ?? null,
    result:       row.result ?? null,
    errorMessage: row.errorMessage ?? null,
    // The autonomy breaker's productivity signal (0385). It MUST survive into
    // `toPlain()` — both breaker call sites read the plain props, and dropping it here
    // would silently restore the failure-only streak with everything else in place.
    produced:     row.produced ?? null,
    startedAt:    row.startedAt ?? null,
    completedAt:  row.completedAt ?? null,
    createdAt:    row.createdAt,
    updatedAt:    row.updatedAt,
  } as ExecutionProps);
}
