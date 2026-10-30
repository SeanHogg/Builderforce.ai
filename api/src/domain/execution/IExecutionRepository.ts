import { Execution } from './Execution';
import { ExecutionId, TaskId, TenantId, ExecutionStatus } from '../shared/types';

export interface ExecutionReadOptions {
  /** Skip the `result` blob — for liveness/breaker callers that never read it. */
  slim?: boolean;
}

export interface IExecutionRepository {
  findById(id: ExecutionId): Promise<Execution | null>;
  findByTask(taskId: TaskId, opts?: ExecutionReadOptions): Promise<Execution[]>;
  /** Executions for ANY of `taskIds` whose status is in `statuses` — one batched
   *  scan (avoids a findByTask per task on hot manager/coordination paths). */
  findByTasksAndStatuses(taskIds: TaskId[], statuses: ExecutionStatus[], opts?: ExecutionReadOptions): Promise<Execution[]>;
  findByTenant(tenantId: TenantId, limit?: number): Promise<Execution[]>;
  findBySession(tenantId: TenantId, sessionId: string, limit?: number): Promise<Execution[]>;
  save(execution: Execution): Promise<Execution>;
  /** Non-terminal writes only; a terminal status is refused (see {@link IExecutionRepository.land}) and never overwrites a terminal row. */
  update(execution: Execution): Promise<Execution>;
  /**
   * THE terminal transition: conditional on a non-terminal status, so exactly one writer wins. `won: false` returns the winner's row
   * and the caller skips its side effects; the outcome owner is told only of a win.
   */
  land(id: ExecutionId, status: TerminalStatus, fields?: LandFields, from?: readonly NonTerminalStatus[], context?: LandContext): Promise<{ won: boolean; execution: Execution }>;
  /** The productivity verdict of a landed run - a field write that never touches the status. */
  setProduced(id: ExecutionId, produced: boolean): Promise<Execution>;
}

/** The terminal execution statuses: reachable only through {@link IExecutionRepository.land}. */
export type TerminalStatus = ExecutionStatus.COMPLETED | ExecutionStatus.FAILED | ExecutionStatus.CANCELLED;

/** The statuses a run can still LAND from - the complement of {@link TerminalStatus}, so a `from` list can never name a terminal one. */
export type NonTerminalStatus = Exclude<ExecutionStatus, TerminalStatus>;

/** What the winner of a landing hands to the outcome owner beyond the row: the run's final tally (`RunState.telemetry`), when it has one. */
export interface LandContext { telemetry?: object }

export interface LandFields { result?: string | null; errorMessage?: string | null; produced?: boolean | null; completedAt?: Date | null }
