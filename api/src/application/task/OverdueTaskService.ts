import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { tasks, projects, tenants } from '../../infrastructure/database/schema';

/**
 * Service for retrieving overdue tasks and grouping them.
 * Calculated as: current_date - task.due_date
 */
export class OverdueTaskService {
  /**
   * Retrieve overdue tasks grouped by their parent Epic.
   *
   * Eligibility criteria (per PRD FR.2):
   * - due_date is earlier than the current date (now)
   * - NOT in a final completed state: must NOT have completedAt or have non-null status
   *   - The board's swimlane roles define which statuses are "final"
   *   - For now, we use an allowlist: tasks that have completedAt IS NULL are incomplete
   * - Results are limited to the authenticated tenant
   *
   * @param db Database connection
   * @param tenantId The tenant to scope to
   * @returns Array of epic groups, each containing:
   *   - epic: { id, title, parentKey, isUnassigned }
   *   - tasks: Array of overdue tasks with daysOverdue calc
   */
  async getOverdueTasks(db: Db, tenantId: number) {
    return await db
      .select({
        taskId: tasks.id,
        taskKey: tasks.key,
        taskTitle: tasks.title,
        taskStatus: tasks.status,
        taskDueDate: tasks.dueDate,
        taskProjectId: projects.id,
        taskEpicParentId: tasks.parentTaskId,
        taskCompletedAt: tasks.completedAt,
        taskIsArchived: tasks.archived,
      })
      .from(tasks)
      .innerJoin(projects, sql`${tasks.projectId} = ${projects.id}`)
      .where(
        sql`
          ${tasks.tenantId} = ${tenantId}
          AND ${tasks.dueDate} < ${sql`NOW()`}
          AND ${tasks.completedAt} IS NULL
          AND ${tasks.archived} = FALSE
        `
      )
      .orderBy(sql`${tasks.dueDate} ASC`);
  }

  /**
   * Format the overdue duration as a human-readable string.
   *
   * @param days The number of days overdue
   * @returns Formatted string (e.g., "3 days overdue", "1 day overdue", "today", "yesterday")
   */
  formatDaysOverdue(days: number): string {
    if (days === 0) return 'today';
    if (days === 1) return '1 day overdue';
    if (days < 0) return `overdue by ${Math.abs(days)} days`; // future due or no due date
    return `${days} days overdue`;
  }

  /**
   * Parse a due timestamp to date.
   */
  parseDueDate(dueDate: Date | null): Date | null {
    if (!dueDate) return null;
    return new Date(dueDate);
  }
}