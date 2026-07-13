/**
 * Task routes module.
 * - Defined in: api/src/routes/taskRoutes.ts
 */

import { Router } from 'express';
import type { ITaskRepository } from '../persistence/TaskRepository';
import { NotFoundError } from '../domain/shared/errors';
import { Task, TaskProgress, computeProgress, getCombinedProgress, enforceProgressInvariant } from '../domain/task/Task';
import { asTaskId } from '../domain/shared/types';
import { createHTTPErrors } from '../presentation/responseHelpers';
import { taskRoutes as vsCodeTaskRoutes } from '../routes/vscodeRoutes'; // Re-export the list view.
import { handlers as taskListHandlers } from '../routes/vscodeRoutes'; // Re-export list handlers.

/**
 * Base response schema (shared by Get by ID).
 */
export interface GetTaskResponse {
  id: string;
  title: string;
  description: string | null;
  status: string;
  parentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  progress: {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
    pending: number;
    percentage: number;
  };
}

type App = Router;

/**
 * Create task-related API routes and attach them to the main app.
 *
 * @param taskRepo - Injection of the domain-aware repository.
 * @returns Express router (containing GET /tasks/:id).
 */
export function taskRoutes(taskRepo: ITaskRepository): App {
  const app = Router();

  // Re-export the GET /tasks (list) endpoint from VSCode.
  app.use('/tasks', (req, res, next) => {
    (taskListHandlers as any).getTasks(req, res, next);
  });

  /**
   * GET /tasks/:id — Returns task details with server-computed progress breakdown.
   *
   * - Forces parentTaskId=null on creation/updates (atomic tasks).
   * - Enforces invariants in computeProgress.
   * - Returns 404 for non-existent tasks.
   */
  app.get('/tasks/:id', (req, res, next) => {
    const id = asTaskId(req.params.id);
    taskRepo
      .getById(id)
      .then((task) => {
        if (!task) {
          throw new NotFoundError('Task', id);
        }

        // Enforce atomic tasks: parentTaskId must be null.
        enforceAtomicTasksConstraint(task);

        // Compute combined progress from entity sum (computed via computeProgress in read path).
        const combined = getCombinedProgress(task);

        // Ensure invariants pass before serialization.
        enforceProgressInvariant(combined);

        // Build response shape matching the test expectations.
        const response: GetTaskResponse = {
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          parentTaskId: task.parentTaskId,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          progress: combined,
        };

        res.status(200).json(response);
      })
      .catch((err) => {
        next(err);
      });
  });

  return app;
}

// -------------------------------------------------------------------------
// Helper functions for progress breakdown.
// -------------------------------------------------------------------------

/**
 * Enforce atomic tasks: parentTaskId must be null. Throw if otherwise.
 */
function enforceAtomicTasksConstraint(task: Task): void {
  if (task.parentTaskId !== null) {
    throw new NotFoundError('Task', task.id); // Treat as not found to ensure loaded tasks are atomic.
  }
}

/**
 * Combine entity-level totals with state counts derived from the saved row.
 */
function getCombinedProgress(task: Task): TaskProgress {
  // Derived state counts from the saved row (retrieved per AC-4).
  const stateCounts = {
    completed: task.progress.completed,
    failed: task.progress.failed,
    skipped: task.progress.skipped,
  };

  // Use raw totals as foundation; pending and percentage will be computed by computeProgress.
  // In subsequent passes, base totals on stored totals (multi-sub-task support).
  return computeProgress(task.progress.total, stateCounts);
}

/**
 * Enforce invariants before serialization. Throws if violated.
 */
function enforceProgressInvariant(progress: TaskProgress): void {
  // Validate integer ranges.
  if (progress.total < 0 || !Number.isInteger(progress.total) ||
      progress.completed < 0 || !Number.isInteger(progress.completed) ||
      progress.failed < 0 || !Number.isInteger(progress.failed) ||
      progress.skipped < 0 || !Number.isInteger(progress.skipped) ||
      progress.pending < 0 || !Number.isInteger(progress.pending) ||
      progress.percentage < 0 || !Number.isInteger(progress.percentage) ||
      progress.percentage > 100) {
    throw new NotFoundError('Task', 'Progress invariant violation (out-of-range fields)'); // Treat as not found since progress cannot be consistent.
  }

  // Invariant: completed + failed + skipped + pending == total.
  const sum = progress.completed + progress.failed + progress.skipped + progress.pending;
  if (sum !== progress.total) {
    throw new NotFoundError('Task', 'Progress invariant violation (mismatched totals)'); // Treat as not found since progress cannot be consistent.
  }
}

// -------------------------------------------------------------------------
// Re-export associated handlers.
// -------------------------------------------------------------------------

export { taskRoutes as vscodeTaskRoutes } from '../routes/vscodeRoutes';