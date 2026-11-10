/**
 * The OPEN work items assigned to one user in one tenant, as `GET /api/vscode/tasks` answers it.
 *
 * A task is assigned to a human OR an agent (never both), so this is the editor's "assigned to
 * me" delivery channel that mirrors the web board's human-assignee lane. Bounded to 50, newest
 * first, open-only (`completed_at IS NULL`), system tasks excluded. Intentionally uncached: a
 * low-QPS interactive poll that MUST reflect a just-assigned task immediately.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { projects, tasks } from '../../infrastructure/database/schema';
import { notSystemTask } from '../task/taskScope';

export const ASSIGNED_TASKS_LIMIT = 50;

export async function listOpenTasksAssignedTo(db: Db, tenantId: number, userId: string) {
  return db
    .select({
      id: tasks.id,
      key: tasks.key,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
      projectId: tasks.projectId,
      projectPublicId: projects.publicId,
      projectName: projects.name,
      githubPrUrl: tasks.githubPrUrl,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(projects.tenantId, tenantId),
        eq(tasks.assignedUserId, userId),
        isNull(tasks.completedAt),
        notSystemTask,
      ),
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(ASSIGNED_TASKS_LIMIT);
}
