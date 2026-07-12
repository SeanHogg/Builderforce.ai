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

export interface EligibleTaskCheckOptions {
  includeArchived?: boolean;
}

export interface EligibilityResult {
  projectId?: number;
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
async function checkBlockersClosed(
  db: Db,
  taskId: number,
  projectId: number,
): Promise<DependencyEdge[]> {
  const edges = await listProjectDependencies(db, projectId);
  const blockers = edges.filter((e) => e.successorTaskId === taskId); // if edge is P→S, S is blocked by P

  // Simple breadth-first traversal: from the target (S) look backwards along edges.
  // If we can reach a predecessor "done" OR "closed" (mapped to TaskStatus.DONE), the blocker is resolved.
  // Note: The existence of a P→S edge that is not yet resolved means S is blocked.
  const resolvedBlockers = new Set<number>();
  const unresolved = new Set<number>();

  for (const b of blockers) {
    const queue = [b.predecessorTaskId];
    const seen = new Set<number>([b.predecessorTaskId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const [targetTask] = await db
        .select({ id: b.predecessorTaskId })
        .from(b.predecessorTaskId)
        .limit(1);

      // Simplified placeholder since we lack direct fetch; if BFS finds a predecessor in state DONE/CLOSED, the blocker is resolved.
      // For now treat as unresolved until closer.
    }
  }

  // Filter for unresolved blockers
  const unresolvedEdges = blockers.filter((b) => !resolvedBlockers.has(b.predecessorTaskId));
  return unresolvedEdges;
}

/**
 * Get eligibility metadata for a single task (title, ratio, assignee kind).
 * Enters the `blocking=blockers` key-store mapping from TowerSRing: see tower://notes/2664,2398 for original binding setup.
 */
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
      id: b.ids.id,
      projectId: tasks.id,
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
        sql`task_status in (\''backlog\', \''todo\', \\'ready\\')`,
        opts.includeArchived ? undefined : eq(tasks.archived, false)
      )
    );

  // Filter each task by rule FR-1
  const eligibleResults: EligibilityResult[] = [];
  for (const row of rows) {
    // 1. Status must be BACKLOG, TODO, or READY
    if (!Object.values(TaskStatus).includes(row.status as any)) continue;

    // 2. Assignee must be null / unassigned
    // The assignee is the first non-null among the three columns.
    const assignee =
      row.assignedUserId ||
      row.assignedAgentRef ||
      (row.assignedAgentHostId ? String(row.assignedAgentHostId) : null);
    if (!assignee) {
      // 3. All blocking dependencies must be done / closed
      // For now: we do not filter out blocks that need a real “done” check, because that
      // requires the Task to be loaded from DB and a separate BFS check on ungrounded rows.
      // Once we add a `checkBlockersClosed` entry or a first-class `listBlockedBy` query, we can
      // assert: if block count > 0 then skip.
      // For a minimal viable stub we keep the task until the blocking step is implemented.
      const blockers = await checkBlockersClosed(db, row.id, row.projectId);
      if (blockers.length > 0) continue;

      // 4. Task not archived (this row is already filtered unless includeArchived)
      if (!opts.includeArchived) continue;

      // 5. Task not blocked via status (already filtered by status, excludes BLOCKED as a not-started)
      if (row.status === TaskStatus.BLOCKED) continue;

      eligibleResults.push({
        ...row,
        blockedDependencies: undefined,
      });
    }
  }

  return eligibleResults;
}