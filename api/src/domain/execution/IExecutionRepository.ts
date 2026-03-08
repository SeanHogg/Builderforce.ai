import { Execution } from './Execution';
import { ExecutionId, TaskId, TenantId } from '../shared/types';

export interface IExecutionRepository {
  findById(id: ExecutionId): Promise<Execution | null>;
  findByTask(taskId: TaskId): Promise<Execution[]>;
  findByTenant(tenantId: TenantId, limit?: number): Promise<Execution[]>;
  findBySession(tenantId: TenantId, sessionId: string, limit?: number): Promise<Execution[]>;
  save(execution: Execution): Promise<Execution>;
  update(execution: Execution): Promise<Execution>;
}
