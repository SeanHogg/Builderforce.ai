/**
 * Overdue items routes — /api/overdue
 *
 * Provides a consolidated overview of all past-due tasks across projects,
 * grouped by their parent Epic. This enables users to quickly identify
 * bottlenecks, assess project health, and prioritize corrective actions.
 *
 * Endpoints:
 * - GET /api/overdue - Retrieve overdue tasks grouped by epic
 */
import { Hono } from 'hono';
import { HonoEnv, Env } from '../../env';
import { authMiddleware, isManager } from '../middleware/authMiddleware';
import type { Db } from '../../infrastructure/database/connection';
import { OverdueTaskService } from '../../application/task/OverdueTaskService';

/**
 * White-list of final task statuses that indicate a task is "done".
 * These are the statuses of rows that sit in swimlanes that represent
 * terminal columns on the board (DONE, CLOSED, ARCHIVED, COMPLETED, etc.).
 *
 * Any task with status in this list should NOT appear as overdue,
 * even if completedAt is somehow null (data inconsistency protection).
 *
 * Note: This list may need adjustment based on the specific swimlane keys
 * used in each project's kanban template.
 */
const FINAL_STATUSES: string[] = [
  'done',
  'completed',
  'closed',
  'archived',
  'cancelled',
];

export function createOverdueRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  const overdueService = new OverdueTaskService();

  /**
   * GET /api/overdue
   *
   * Retrieve all overdue tasks grouped by their parent Epic.
   *
   * Response structure:
   * {
   *   overdueTasks: [
   *     {
   *       epic: { id, title, projectKey, isUnassigned: boolean },
   *       tasks: [
   *         {
   *           task: { id, title, dueDate, daysOverdue },
   *           project: { id, key, name }
   *         }
   *       ]
   *     }
   *   ],
   *   totalOverdue: number
   * }
   *
   * @param c Hono context
   */
  router.get('/', async (c) => {
    try {
      const tenantId = c.get('tenantId') as number;

      // Fetch all eligible overdue tasks
      const rows = await overdueService.getOverdueTasks(db, tenantId);

      // Group by Epic (or "No Epic")
      const epicGroups = new Map<string, Array<any>>();

      for (const row of rows) {
        // Check if task is in a final state (should not happen with the service query
        // but serves as extra safety)
        if (
          FINAL_STATUSES.includes(row.taskStatus?.toLowerCase() || '')
        ) {
          continue;
        }

        const epicKey =
          row.taskEpicParentId == null
            ? '__NO_EPIC__' // Distinct group for unassigned tasks
            : row.taskEpicParentId.toString();

        if (!epicGroups.has(epicKey)) {
          epicGroups.set(epicKey, []);
        }

        // Calculate days overdue
        const dueDate = overdueService.parseDueDate(row.taskDueDate);
        let daysOverdue = null as number | null;

        if (dueDate) {
          const now = new Date();
          daysOverdue = Math.floor(
            Math.abs((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
          );
        }

        epicGroups.get(epicKey)!.push({
          task: {
            id: row.taskId,
            key: row.taskKey,
            title: row.taskTitle,
            dueDate: row.taskDueDate,
            status: row.taskStatus,
          },
          daysOverdue,
          epicId: row.taskEpicParentId,
          projectId: row.taskProjectId,
        });
      }

      // Build response structure
      const groupedData = Array.from(epicGroups.entries()).map(
        ([key, tasks]) => {
          const epicInfo = this._getEpicInfo(tasks, key);

          return {
            epic: epicInfo,
            tasks: tasks.map((t) => ({
              task: t.task,
              daysOverdue: this._formatDaysOverdue(t.daysOverdue!),
            })),
          };
        }
      );

      // Additional aggregate metadata
      const totalOverdue = rows.length;

      return c.json({
        overdueTasks: groupedData,
        totalOverdue,
        summary: {
          totalTasks: totalOverdue,
          epicGroupsCount: groupedData.length,
        },
      });
    } catch (error) {
      console.error('Error fetching overdue tasks:', error);
      return c.json(
        { error: 'Failed to fetch overdue tasks' },
        500
      );
    }
  });

  /**
   * Extract Epic-related info from the mismatched shape on tasks.
   */
  _getEpicInfo = (tasks: Array<any>, epicKey: string) => {
    if (epicKey === '__NO_EPIC__') {
      return {
        id: null,
        title: 'Tasks without Epic',
        parentKey: null,
        isUnassigned: true,
      };
    }

    // For now, tasks that have a parentTaskId are considered to belong to that task
    // even if we don't have details about the parent itself. In a future enhancement,
    // we could join back to tasks.parentTaskId to get the Epic's title.
    // For the current implementation, we'll display the task whose parent is the Epic.
    const firstTask = tasks[0];
    return {
      id: epicKey,
      title: firstTask.epicId
        ? firstTask.taskTitle // Use the parent task's title as the Epic placeholder
        : 'Unknown Epic',
      parentKey: epicKey,
      isUnassigned: false,
    };
  };

  /**
   * Format the overdue duration string.
   */
  _formatDaysOverdue = (days: number | null) => {
    if (days === null) return 'No due date';
    return this._daysOverdue(days);
  };

  /**
   * Format days overdue.
   */
  _daysOverdue = (days: number) => {
    if (days === 0) return 'today';
    if (days === 1) return '1 day overdue';
    if (days < 0) return `overdue by ${Math.abs(days)} days`;
    return `${days} days overdue`;
  };
}