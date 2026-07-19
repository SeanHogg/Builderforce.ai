import { Execution } from './Execution';
import { ExecutionId, TaskId, TenantId, ExecutionStatus } from '../shared/types';

export interface IExecutionRepository {
  findById(id: ExecutionId): Promise<Execution | null>;
  findByTask(taskId: TaskId): Promise<Execution[]>;
  /** Executions for ANY of `taskIds` whose status is in `statuses` — one batched
   *  scan (avoids a findByTask per task on hot manager/coordination paths). */
  findByTasksAndStatuses(taskIds: TaskId[], statuses: ExecutionStatus[]): Promise<Execution[]>;
  findByTenant(tenantId: TenantId, limit?: number): Promise<Execution[]>;
  findBySession(tenantId: TenantId, sessionId: string, limit?: number): Promise<Execution[]>;
  save(execution: Execution): Promise<Execution>;
  update(execution: Execution): Promise<Execution>;
}
