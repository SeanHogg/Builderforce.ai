import { and, desc, eq, getTableColumns, inArray, or, sql } from 'drizzle-orm';
import { IExecutionRepository, type ExecutionReadOptions, type LandContext, type LandFields, type NonTerminalStatus, type TerminalStatus } from '../../domain/execution/IExecutionRepository';
import { Execution, ExecutionProps } from '../../domain/execution/Execution';
import {
  ExecutionId, TaskId, TenantId, AgentId, AgentHostId, ExecutionStatus,
  asExecutionId, asTaskId, asTenantId, asAgentId, asAgentHostId,
} from '../../domain/shared/types';
import { executions as executionsTable } from '../database/schema';
import type { Db } from '../database/connection';
import { EXECUTION_NON_TERMINAL_STATUSES } from '../../domain/shared/terminalStatus';

/** Newest terminal runs kept per ticket by {@link ExecutionRepository.findByTask}. Far above
 *  MAX_AUTONOMOUS_RUNS_PER_TASK and the breaker streak, so every gate that counts runs
 *  sees the same answer — it only stops a pathological ticket loading thousands of rows. */
export const TASK_EXECUTION_HISTORY_LIMIT = 500;

/** Every column but the `result` blob: the liveness/breaker/backoff callers never read it. */
const { result: _resultBlob, ...SLIM_COLUMNS } = getTableColumns(executionsTable);

export class ExecutionRepository implements IExecutionRepository {
  /**
   * `hooks.onTerminal` is told of every persisted write that leaves the execution in a terminal status - the single place a
   * terminal status lands, so the run's outcome row is recorded here and nowhere else (`cloudOutcomeRow`). Optional: a repository
   * built without it (a read path, a test) records nothing.
   */
  constructor(private readonly db: Db, private readonly hooks: { onTerminal?: (saved: Execution, context: LandContext) => Promise<void> } = {}) {}

  async findById(id: ExecutionId): Promise<Execution | null> {
    const [row] = await this.db
      .select().from(executionsTable)
      .where(eq(executionsTable.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  /** CAPPED: every non-terminal run plus the ticket's newest {@link TASK_EXECUTION_HISTORY_LIMIT}
   *  (500) runs, newest first — older history of a pathological ticket is not returned (callers
   *  that gate on run counts stay far below the cap). `slim` leaves the `result` blob unread (it comes back null). */
  async findByTask(taskId: TaskId, opts: ExecutionReadOptions = {}): Promise<Execution[]> {
    const rows = await this.select(opts.slim)
      .where(and(
        eq(executionsTable.taskId, taskId),
        or(
          inArray(executionsTable.status, [...EXECUTION_NON_TERMINAL_STATUSES]),
          inArray(executionsTable.id, sql`(select id from executions where task_id = ${taskId} order by created_at desc limit ${TASK_EXECUTION_HISTORY_LIMIT})`),
        ),
      ))
      .orderBy(desc(executionsTable.createdAt));
    return rows.map(toDomain);
  }

  async findByTasksAndStatuses(taskIds: TaskId[], statuses: ExecutionStatus[], opts: ExecutionReadOptions = {}): Promise<Execution[]> {
    if (taskIds.length === 0 || statuses.length === 0) return [];
    const rows = await this.select(opts.slim)
      .where(and(
        inArray(executionsTable.taskId, taskIds),
        inArray(executionsTable.status, statuses),
      ))
      .orderBy(desc(executionsTable.createdAt));
    return rows.map(toDomain);
  }

  private select(slim?: boolean) {
    return slim
      ? this.db.select(SLIM_COLUMNS).from(executionsTable)
      : this.db.select().from(executionsTable);
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
        source:      plain.source,
      })
      .returning();
    if (!inserted) throw new Error('Execution insert returned no rows');
    return toDomain(inserted);
  }

  /**
   * Non-terminal field writes only (start, in-flight state). A terminal status is NEVER written here - it lands through
   * {@link land} - and the write is guarded `status NOT IN terminal`, so a stale RUNNING write can never resurrect a
   * cancelled / failed / completed row.
   */
  async update(execution: Execution): Promise<Execution> {
    const plain = execution.toPlain();
    if (isTerminalStatus(plain.status)) throw new TerminalStatusViaUpdateError(plain.status);
    const [updated] = await this.db
      .update(executionsTable)
      .set({
        status:       plain.status,
        result:       plain.result ?? undefined,
        errorMessage: plain.errorMessage ?? undefined,
        startedAt:    plain.startedAt ?? undefined,
        updatedAt:    new Date(),
      })
      .where(and(eq(executionsTable.id, plain.id), inArray(executionsTable.status, [...EXECUTION_NON_TERMINAL_STATUSES])))
      .returning();
    if (!updated) {
      // The run went terminal under a stale write: the terminal row stands.
      const current = await this.findById(plain.id);
      if (current) return current;
      throw new Error('Execution update returned no rows');
    }
    return toDomain(updated);
  }

  /**
   * THE terminal transition: `UPDATE ... WHERE status IN (non-terminal)`. Exactly one writer wins; the winner's row is returned with
   * `won: true` and the outcome owner (`hooks.onTerminal`) is told ONCE, after the row is persisted. A loser gets the winner's row
   * with `won: false` and nothing fires - callers skip their side effects (audit, milestones, DO signals, lane moves).
   */
  async land(
    id: ExecutionId,
    status: TerminalStatus,
    fields: LandFields = {},
    /** Land only from these statuses (default: any non-terminal one) - e.g. a stranded dispatch must never clobber a run that has started. */
    from?: readonly NonTerminalStatus[],
    /** What the winner's outcome owner needs beyond the row: the run's final tally. */
    context: LandContext = {},
  ): Promise<{ won: boolean; execution: Execution }> {
    const now = new Date();
    const [row] = await this.db
      .update(executionsTable)
      .set({
        status,
        result:       fields.result ?? undefined,
        errorMessage: fields.errorMessage ?? undefined,
        // `?? undefined` is load-bearing: a null (not judged) never overwrites a verdict `finalizeCloudRun` already wrote.
        produced:     fields.produced ?? undefined,
        completedAt:  fields.completedAt ?? now,
        updatedAt:    now,
      })
      .where(and(eq(executionsTable.id, id), inArray(executionsTable.status, [...(from ?? EXECUTION_NON_TERMINAL_STATUSES)])))
      .returning();
    if (!row) {
      const winner = await this.findById(id);
      if (!winner) throw new Error('Execution land found no row');
      return { won: false, execution: winner };
    }
    const execution = toDomain(row);
    await this.hooks.onTerminal?.(execution, context);
    return { won: true, execution };
  }

  /** The productivity verdict (0385) - a field of a LANDED run, written without touching its status. */
  async setProduced(id: ExecutionId, produced: boolean): Promise<Execution> {
    const [row] = await this.db.update(executionsTable).set({ produced, updatedAt: new Date() }).where(eq(executionsTable.id, id)).returning();
    if (!row) throw new Error('Execution setProduced returned no rows');
    return toDomain(row);
  }
}


const isTerminalStatus = (status: ExecutionStatus): status is TerminalStatus => !EXECUTION_NON_TERMINAL_STATUSES.includes(status);

/** `update()` was handed a terminal status: callers must land it (`land`). */
export class TerminalStatusViaUpdateError extends Error {
  constructor(status: string) {
    super(`ExecutionRepository.update refuses terminal status '${status}': use land()`);
    this.name = 'TerminalStatusViaUpdateError';
  }
}

function toDomain(row: Omit<typeof executionsTable.$inferSelect, 'result'> & { result?: string | null }): Execution {
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
    source:       (row.source === 'vscode' || row.source === 'brain') ? row.source : 'agent',
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
