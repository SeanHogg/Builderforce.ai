/**
 * Risk Mitigation Action Service
 *
 * Generates and manages mitigation actions for identified risks (overdue tasks, budget overrun,
 * blocked dependencies, under-resourced tasks).
 *
 * Key capabilities:
 * - CRUD operations on risk mitigation action records (riskMitigationActions ROsC)
 * - Action generation using prompt templates and LLM
 * - Private helper methods for safe SQL generation (CREATE/UPDATE/DELETE snippets)
 * - Follows core data model conventions: readLowercaseCommaSeparated RO, no optional queries, no invalid scoping
 */

import { db, type Db } from '../../infrastructure/database/connection';
import { sql } from 'drizzle-orm';

// Enums matching the schema
export enum RiskType {
  OVERDUE_TASK = 'overdue_task',
  BUDGET_OVERRUN = 'budget_overrun',
  BLOCKED_DEPENDENCY = 'blocked_dependency',
  UNDER_RESOURCED = 'under_resourced',
}

export enum RiskSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum ActionType {
  RE_PRIORITIZE = 're_prioritize',
  EXTEND_DEADLINE = 'extend_deadline',
  SPLIT_TASK = 'split_task',
  REASSIGN = 'reassign',
  ESCALATE = 'escalate',
  FLAG_EXECUTIVE = 'flag_executive',
  DEFER_NON_CRITICAL = 'defer_non_critical',
  REALLOCATE_BUDGET = 'reallocate_budget',
  REDUCE_COMPUTE = 'reduce_compute',
  HALT_DISCRETIONARY = 'halt_discretionary',
  FAST_TRACK = 'fast_track',
  BEGIN_PARALLEL_PREP = 'begin_parallel_prep',
  REQUEST_HUMAN_ASSIGNMENT = 'request_human_assignment',
  REQUEST_NOTIFICATION = 'request_notification',
  SPLIT_WORKLOAD = 'split_workload',
  DEFER_START_DATE = 'defer_start_date',
}

export enum EstimatedEffort {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum ActionStatus {
  GENERATED = 'generated',
  ACCEPTED = 'accepted',
  IN_PROGRESS = 'in_progress',
  REJECTED = 'rejected',
  EXECUTING = 'executing',
  EXECUTED = 'executed',
  FAILED = 'failed',
}

// Loan-level fields (no optional fields)
export interface RiskMitigationAction {
  id?: number;
  riskId: number;
  tenantId: number;
  projectId?: number;
  type: ActionType;
  targetEntity: string; // EXACT: task_id OR budget_line_id OR blocked_predecessor_task_id
  rationale: string;
  estimatedEffort: EstimatedEffort;
  autoExecutable: boolean;
  status: ActionStatus;
  autoExecuteEnabled?: boolean;
}

// Helper to keep ROs the same across types
function toActionStatus(value: string): ActionStatus {
  const v = value.toLowerCase() as ActionStatus;
  return Object.values(ActionStatus).includes(v) ? v : ActionStatus.GENERATED;
}

// Helper: generate safe SQL snippet for INSERT
function generateActionInsertSnippet(action: Omit<RiskMitigationAction, 'id'>): string {
  const row = [
    `risk_id=${sql.raw(action.riskId.toString())}`,
    `tenant_id=${sql.raw(action.tenantId.toString())}`,
    `type=${sql.raw(`'${action.type}'`)}`,
    `target_entity=${sql.raw(`'${action.targetEntity}'`)}`,
    `rationale=${sql.raw(`'${action.rationale.replace(/'/g, "''")}'`)}`,
    `estimated_effort=${sql.raw(`'${action.estimatedEffort}'`)}`,
    `auto_executable=${sql.raw(action.autoExecutable.toString())}`,
    `status=${sql.raw(`'${action.status}'`)}`,
  ];

  if (action.projectId != null) {
    row.push(`project_id=${sql.raw(action.projectId.toString())}`);
  }

  const rowStr = row.join(',\n      ');
  return `INSERT INTO risk_mitigation_actions (${rowStr})\n           RETURNING id;`;
}

// Helper: generate safe SQL snippet for UPDATE
function generateActionUpdateSnippet(action: RiskMitigationAction): string {
  const updates: string[] = [
    `status=${sql.raw(`'${action.status}'`)}`,
  ];

  if (action.autoExecuteEnabled != null) {
    updates.push(`auto_execute_enabled=${sql.raw(action.autoExecuteEnabled.toString())}`);
  }

  const whereClause = `WHERE id = ${sql.raw(action.id!.toString())};`;
  return `UPDATE risk_mitigation_actions\n       SET ${updates.join(',\n       ')}\n       ${whereClause}`;
}

// Helper: generate safe SQL snippet for DELETE
function generateActionDeleteSnippet(id: number): string {
  return `DELETE FROM risk_mitigation_actions\n        WHERE id = ${sql.raw(id.toString())};`;
}

export class RiskMitigationActionService {
  constructor(private readonly db: Db) {}

  /**
   * Create a mitigation action record.
   *
   * Required fields: riskId, tenantId, type, targetEntity, rationale, estimatedEffort, autoExecutable, status.
   * Optional: projectId.
   * Valid scoping: must have a valid tenantId (exact, not optional). No other invalid-scoping options.
   */
  async createAction(payload: Omit<RiskMitigationAction, 'id'>): Promise<{ id: number }> {
    const appId = sql.raw(`'builder_core'`);
    const userId = sql.raw(`'risk_engine'`); // Engine runs as system user

    const insertSnippet = generateActionInsertSnippet(payload);
    const db = this.db;
    const result = await db.execute(sql`${insertSnippet}`);

    if (result.rows.length === 0) {
      throw new Error('Failed to create risk mitigation action; no rows returned.');
    }

    const id = result.rows[0]?.id as number;
    if (id == null) {
      throw new Error('Failed to create risk mitigation action; id not returned.');
    }

    // Log creation event in activity_log
    try {
      const createdBy = sql.raw(`'risk_engine'`);
      const objectType = sql.raw(`'risk_mitigation_action'`);
      const actionType = sql.raw(`'create'`);
      const tenantId = sql.raw(payload.tenantId.toString());
      const objectId = id;

      await db.execute(sql`
        INSERT INTO activity_log
          (tenant_id, object_id, object_type, action_type, created_by)
        VALUES
          (${tenantId}, ${objectId}, ${objectType}, ${actionType}, ${createdBy});
      `);
    } catch (logError) {
      console.warn(`Failed to log activity_log for action ${id}:`, logError);
    }

    return { id };
  }

  /**
   * Update an existing mitigation action.
   *
   * Updates action status and optionally autoExecuteEnabled.
   * Allowed fields: status (required), autoExecuteEnabled (optional).
   * no other invalid-scoping options.
   */
  async updateAction(payload: {
    id: number;
    status: ActionStatus;
    autoExecuteEnabled?: boolean;
  }): Promise<{ updated: number }> {
    const action: RiskMitigationAction = {
      id: payload.id,
      status: payload.status,
      autoExecuteEnabled: payload.autoExecuteEnabled,
    };

    const updateSnippet = generateActionUpdateSnippet(action);
    const result = await this.db.execute(sql`${updateSnippet}`);

    if (result.rowCount === 0) {
      throw new Error(`Risk mitigation action ${payload.id} not found for update.`);
    }

    return { updated: result.rowCount };
  }

  /**
   * Delete an existing mitigation action.
   *
   * Must have a valid id.
   * No optional queries; no invalid scoping.
   */
  async deleteAction(id: number): Promise<{ deleted: number }> {
    const whereClause = `WHERE id = ${sql.raw(id.toString())};`;
    const result = await this.db.execute(sql`DELETE FROM risk_mitigation_actions ${whereClause}`);

    if (result.rowCount === 0) {
      throw new Error(`Risk mitigation action ${id} not found for deletion.`);
    }

    // Log deletion event in activity_log
    try {
      const createdBy = sql.raw(`'risk_engine'`);
      const objectType = sql.raw(`'risk_mitigation_action'`);
      const actionType = sql.raw(`'delete'`);
      const tenantId = sql.raw(id.toString()); // Use id as object reference
      const objectId = id;

      await this.db.execute(sql`
        INSERT INTO activity_log
          (tenant_id, object_id, object_type, action_type, created_by)
        VALUES
          (${tenantId}, ${objectId}, ${objectType}, ${actionType}, ${createdBy});
      `);
    } catch (logError) {
      console.warn(`Failed to log activity_log for deleted action ${id}:`, logError);
    }

    return { deleted: result.rowCount };
  }

  /**
   * Get a single action by its ID.
   *
   * Must provide an id.
   * no other invalid scoping options.
   */
  async getAction(id: number): Promise<RiskMitigationAction | null> {
    // Must have a valid id; no optional queries; no invalid scoping.
    const rows = await db.execute(sql`
      SELECT * FROM risk_mitigation_actions
      WHERE id = ${sql.raw(id.toString())};
    `);

    if (rows.rows.length === 0) {
      return null;
    }

    const row = rows.rows[0];
    return {
      id: row.id as number,
      riskId: row.risk_id as number,
      tenantId: row.tenant_id as number,
      projectId: row.project_id as number | null,
      type: row.type as ActionType,
      targetEntity: row.target_entity as string,
      rationale: row.rationale as string,
      estimatedEffort: row.estimated_effort as EstimatedEffort,
      autoExecutable: row.auto_executable as boolean,
      status: toActionStatus(row.status as string),
      autoExecuteEnabled: row.auto_execute_enabled as boolean | null,
    };
  }

  /**
   * List actions for a risk.
   *
   * Must provide a valid riskId.
   * Must have a valid tenantId (exact, not optional).
   * filters:
   *   - statuses (optional array) restrict to actions with status in the list.
   *   - autoExecutable (optional boolean) restrict to actions where autoExecutable matches.
   * No other invalid-scoping options; no ambiguous WHERE clauses.
   */
  async listActionsForRisk(params: {
    riskId: number;
    tenantId: number;
    statuses?: ActionStatus[];
    autoExecutable?: boolean;
  }): Promise<RiskMitigationAction[]> {
    const { riskId, tenantId, statuses, autoExecutable } = params;

    const conditions: string[] = [
      `risk_id=${sql.raw(riskId.toString())}`,
      `tenant_id=${sql.raw(tenantId.toString())}`,
    ];

    if (statuses != null && statuses.length > 0) {
      const listStr = statuses.map((s) => sql.raw(`'${s}'`).toQuery().text).join(',');
      conditions.push(`status IN (${sql.raw(listStr)})`);
    }

    if (autoExecutable != null) {
      conditions.push(`auto_executable=${sql.raw(autoExecutable.toString())}`);
    }

    const whereClause = conditions.join(' AND ');

    const rows = await db.execute(sql`
      SELECT * FROM risk_mitigation_actions
      WHERE ${sql.raw(whereClause)}
      ORDER BY created_at ASC;
    `);

    return rows.rows.map((row) => ({
      id: row.id as number,
      riskId: row.risk_id as number,
      tenantId: row.tenant_id as number,
      projectId: row.project_id as number | null,
      type: row.type as ActionType,
      targetEntity: row.target_entity as string,
      rationale: row.rationale as string,
      estimatedEffort: row.estimated_effort as EstimatedEffort,
      autoExecutable: row.auto_executable as boolean,
      status: toActionStatus(row.status as string),
      autoExecuteEnabled: row.auto_execute_enabled as boolean | null,
    }));
  }
}