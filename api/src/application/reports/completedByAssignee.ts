/**
 * Completed-by-assignee rollup (gap [1253]) — tasks that moved into a done-class
 * lane within a window, one bucket per assignee (human OR agent).
 */

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, projects, tasks, users } from '../../infrastructure/database/schema';
import { notSystemTask } from '../task/taskScope';
import { DONE_CLASS_STATUSES } from '../../domain/shared/doneClass';

/** Window (days) clamp — guards against unbounded scans / silly query params. */
const COMPLETED_WINDOW_MIN_DAYS = 1;
const COMPLETED_WINDOW_MAX_DAYS = 365;
const COMPLETED_WINDOW_DEFAULT_DAYS = 7;

/** The `?days=` query param, clamped to [1, 365] (default 7). */
export function clampCompletedWindowDays(raw: string | undefined): number {
  const parsed = raw ? parseInt(raw, 10) : COMPLETED_WINDOW_DEFAULT_DAYS;
  return Math.min(
    COMPLETED_WINDOW_MAX_DAYS,
    Math.max(COMPLETED_WINDOW_MIN_DAYS, Number.isFinite(parsed) ? parsed : COMPLETED_WINDOW_DEFAULT_DAYS),
  );
}

/** One task row as it feeds the grouping (the columns the rollup needs). */
export interface CompletedTaskRow {
  taskId:              number;
  status:              string;
  completedAt:         Date;
  assignedUserId:      string | null;
  assignedUserName:    string | null;
  assignedAgentHostId: number | null;
  assignedHostName:    string | null;
  assignedAgentRef:    string | null;
}

export interface AssigneeRollup {
  assigneeKind: 'human' | 'agent_host' | 'cloud_agent' | 'unassigned';
  assigneeId:   string;
  assigneeName: string;
  completed:    number;
  lastCompletedAt: string;
}

/**
 * Pure grouping: collapse completed task rows into one bucket per assignee
 * (a human OR an agent — host or cloud — are first-class peers on the board, so
 * each is its own row). Exported for unit testing without a DB.
 *
 * Assignee identity precedence mirrors the data model's "exactly one owner"
 * invariant: human > agent host > cloud agent. A row with none falls into a
 * single `unassigned` bucket.
 */
export function groupCompletedByAssignee(rows: CompletedTaskRow[]): AssigneeRollup[] {
  const byKey = new Map<string, AssigneeRollup>();

  for (const row of rows) {
    let kind: AssigneeRollup['assigneeKind'];
    let id: string;
    let name: string;

    if (row.assignedUserId) {
      kind = 'human';
      id = `user:${row.assignedUserId}`;
      name = row.assignedUserName || row.assignedUserId;
    } else if (row.assignedAgentHostId != null) {
      kind = 'agent_host';
      id = `host:${row.assignedAgentHostId}`;
      name = row.assignedHostName || `Agent host #${row.assignedAgentHostId}`;
    } else if (row.assignedAgentRef) {
      kind = 'cloud_agent';
      id = `agent:${row.assignedAgentRef}`;
      name = row.assignedAgentRef;
    } else {
      kind = 'unassigned';
      id = 'unassigned';
      name = 'Unassigned';
    }

    const prev = byKey.get(id);
    if (prev) {
      prev.completed += 1;
      if (row.completedAt.getTime() > new Date(prev.lastCompletedAt).getTime()) {
        prev.lastCompletedAt = row.completedAt.toISOString();
      }
    } else {
      byKey.set(id, {
        assigneeKind: kind,
        assigneeId:   id,
        assigneeName: name,
        completed:    1,
        lastCompletedAt: row.completedAt.toISOString(),
      });
    }
  }

  // Busiest assignee first; stable name tiebreak.
  return Array.from(byKey.values()).sort(
    (a, b) => b.completed - a.completed || a.assigneeName.localeCompare(b.assigneeName),
  );
}

/**
 * Tasks that moved into a done-class lane within the last `days`, grouped by
 * assignee (human or agent). Completion time is the dedicated `tasks.completed_at`
 * (set on the first done-class transition by recordStatusTransition, migration
 * 0117), so later edits to a finished ticket no longer shift the window. Legacy
 * rows predating 0117 have a null `completed_at`, so we COALESCE to `updatedAt`
 * as the backfill proxy. Tenant-scoped by joining projects (tasks carry no tenant_id).
 */
export async function generateCompletedByAssigneeReport(db: Db, tenantId: number, days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // Authoritative completion instant with a legacy fallback.
  const completedAtExpr = sql<Date>`COALESCE(${tasks.completedAt}, ${tasks.updatedAt})`;

  const rows = await db
    .select({
      taskId:              tasks.id,
      status:              tasks.status,
      completedAt:         completedAtExpr,
      assignedUserId:      tasks.assignedUserId,
      assignedUserName:    users.displayName,
      assignedAgentHostId: tasks.assignedAgentHostId,
      assignedHostName:    agentHosts.name,
      assignedAgentRef:    tasks.assignedAgentRef,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(users, eq(users.id, tasks.assignedUserId))
    .leftJoin(agentHosts, eq(agentHosts.id, tasks.assignedAgentHostId))
    .where(and(
      eq(projects.tenantId, tenantId),
      eq(tasks.archived, false),
      inArray(tasks.status, DONE_CLASS_STATUSES as string[]),
      gte(completedAtExpr, since),
      notSystemTask,
    ));

  const assignees = groupCompletedByAssignee(rows as CompletedTaskRow[]);
  const totalCompleted = rows.length;

  return {
    reportType:   'completed_by_assignee',
    windowDays:   days,
    since:        since.toISOString(),
    generatedAt:  new Date().toISOString(),
    totalCompleted,
    assigneeCount: assignees.length,
    assignees,
  };
}
