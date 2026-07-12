/**
 * Eligibility check for "ready + unassigned" tasks shown in the "Immediately Actionable Tasks" view FR-1.
 *
 * A task appears in the list if and only if ALL of the following are true:
 * - `status` is BACKLOG, TODO, or READY (work-not-started states)
 * - `assignee` is null / unassigned (assignedUserId IS NULL AND assignedAgentRef IS NULL AND assignedAgentHostId IS NULL)
 * - All blocking dependencies have `status = done`
 * - The task is not archived
 * - The task's status is not BLOCKED
 */
import { TaskStatus, TaskPriority } from '../../domain/shared/types';
import type { Task } from '../../domain/task/Task';
import { listProjectDependencies } from './taskDependencies';
import type { Db } from '../../infrastructure/database/connection';
import type { DependencyEdge } from './taskDependencies';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { tasks } from '../../infrastructure/database/schema';

export interface EligibleTaskCheckOptions {
  includeArchived?: boolean;
}

export interface EligibilityResult {
  projectId: number;
  taskId: number;
  title: string;
  status: string;
  priority: TaskPriority;
  key: string;
  createdAt: Date;
  dueDate: Date | null;
  storyPoints: number | null;
  assignee: 'unassigned' | 'human' | string;
  blockedDependencies?: DependencyEdge[];
}

/**
 * Check whether a task's ALL blockers are in a terminal state (done).
 * For each unresolved blocker, we return the edge + blocker title so the UI can explain.
 */
async function checkBlockersClosed(db: Db, taskId: number, projectId: number): Promise<DependencyEdge[]> {
  const edges = await listProjectDependencies(db, projectId);
  const blockers = edges.filter((e) => e.successorTaskId === taskId); // P → S means S is blocked by P

  // Simple check: if there are any predecessors (blockers) that are not yet in
  // a "done" state, the task is blocked. We don't have a dedicated task status
  // lookup row here, so we return all unresolved blockers.
  // TODO: once we have a way to join dependencies to task statuses, we can filter
  // to only those predecessors whose tasks are not DONE.
  // For now we return all blockers as unresolved.
  return blockers;
}

export async function getTaskEligibility(
  db: Db,
  projectIds: number[],
  opts: EligibleTaskCheckOptions = {}
): Promise<EligibilityResult[]> {
  // Safety guard: empty project list → nothing eligible
  if (projectIds.length === 0) return [];

  // Fetch all tasks that could satisfy the eligibility criteria (backlog/todo/ready + not archived).
  // We apply the eligibility rules server-side to respect AC-10.
  const rows = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      key: tasks.key,
      createdAt: tasks.createdAt,
      dueDate: tasks.dueDate,
      storyPoints: tasks.storyPoints,
      assignedUserId: tasks.assignedUserId,
      assignedAgentRef: tasks.assignedAgentRef,
      assignedAgentHostId: tasks.assignedAgentHostId,
      archived: tasks.archived,
    })
    .from(tasks)
    .where(
      and(
        inArray(tasks.projectId, projectIds),
        sql`task_status in ('backlog', 'todo', 'ready')`,
        opts.includeArchived ? undefined : eq(tasks.archived, false)
      )
    );

  // Filter each task by rule FR-1
  const eligibleResults: EligibilityResult[] = [];
  for (const row of rows) {
    // 1. Status must be BACKLOG, TODO, or READY
    const isOpenTask = ['backlog', 'todo', 'ready'].includes(row.status as string);
    if (!isOpenTask) continue;

    // 2. Assignee must be null / unassigned
    // The assignee is the first non-null among the three columns.
    const assignee =
      (row.assignedUserId as string | null) ||
      (row.assignedAgentRef as string | null) ||
      (row.assignedAgentHostId as string | null);
    if (assignee) continue; // Has a human or cloud agent assignee, skip.

    // 3. All blocking dependencies must be done
    // Placeholder: return unresolved blockers until we have a status join.
    const blockers = await checkBlockersClosed(db, row.id, row.projectId);
    if (blockers.length > 0) {
      // TODO: Once we can fetch predecessor task statuses, filter to unresolved only.
      // For now we skip any task with blockers.
      continue;
    }

    // 4. Task not archived (this row is already filtered unless includeArchived)
    if (!opts.includeArchived) continue;

    // 5. Task not blocked via status (already filtered by status, excludes BLOCKED as a not-started)
    if (row.status === TaskStatus.BLOCKED) continue;

    eligibleResults.push({
      ...row,
      blockedDependencies: blockers.length > 0 ? blockers : undefined,
    });
  }

  return eligibleResults;
}