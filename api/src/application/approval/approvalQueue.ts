/**
 * READ THE APPROVAL QUEUE — the list/detail half of the approval primitive
 * (`requestApproval` raises, `decideApproval` decides, this reads).
 *
 * Moved out of `approvalRoutes.ts` so the route holds no table access.
 */
import { and, desc, eq, getTableColumns } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { approvals, executions, tasks } from '../../infrastructure/database/schema';
import { isApprovalVisibleTo } from '../../domain/approval/selfOwned';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';

export interface ApprovalListFilter {
  status?: string | null;
  agentHostId?: number | null;
  projectId?: number | null;
}

/**
 * The tenant's approvals, newest first, each enriched with the `taskId` and
 * `projectId` of the work that caused it (null when not tied to a task), so callers
 * can show and group the queue without a second round-trip.
 */
export async function listApprovals(db: Db, tenantId: number, viewerUserId: string | undefined, filter: ApprovalListFilter = {}) {
  let rows = await db
    .select({ ...getTableColumns(approvals), taskId: tasks.id, projectId: tasks.projectId })
    .from(approvals)
    .leftJoin(executions, eq(approvals.executionId, executions.id))
    .leftJoin(tasks, eq(executions.taskId, tasks.id))
    .where(eq(approvals.tenantId, tenantId))
    .orderBy(desc(approvals.createdAt)).limit(LIST_ROW_CAP);

  // Someone else's self-owned approvals (their desktop's steps) are not the tenant's queue.
  rows = rows.filter((r) => isApprovalVisibleTo(r, viewerUserId));
  if (filter.status) rows = rows.filter((r) => r.status === filter.status);
  if (filter.agentHostId != null) rows = rows.filter((r) => r.agentHostId === filter.agentHostId);
  if (filter.projectId != null) rows = rows.filter((r) => r.projectId === filter.projectId);
  return rows;
}

/** One approval the viewer may see, or null (a self-owned one is invisible to others). */
export async function getApproval(db: Db, tenantId: number, viewerUserId: string | undefined, id: string) {
  const [row] = await db.select().from(approvals).where(and(eq(approvals.id, id), eq(approvals.tenantId, tenantId)));
  return row && isApprovalVisibleTo(row, viewerUserId) ? row : null;
}
