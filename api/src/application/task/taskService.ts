/**
 * Task application service layer.
 * Defined in: api/src/application/task/taskService.ts
 */

import type { Task, TaskProgress } from '../../domain/task/Task';
import { TaskProgressInvariantError } from '../../errors/TaskErrors';

/**
 * Service for task operations including computed progress.
 */
export class TaskService {
  /**
   * Retrieves a task and calculates its progress breakdown.
   *
   * @param task - The task entity
   * @returns Progress object computed from the task's current status
   */
  static getTaskWithProgress(task: Task): TaskProgress {
    const progress = computeProgress(task);
    return progress;
  }
}

/**
 * Computes the progress breakdown for a task from its current status.
 *
 * FR/AC rules:
 * - When total = 0: all count fields = 0, percentage = 100.
 * - percentage = floor((completed / total) * 100) for non-zero total.
 * - pending = total - completed - failed - skipped.
 * - Invariant: completed + failed + skipped <= total at all times.
 *
 * @param task - The task entity
 * @returns Computed progress object
 * @throws TaskProgressInvariantError if the invariant is violated
 */
function computeProgress(task: Task): TaskProgress {
  const { status, parentTaskId, createdAt, updatedAt, id, title, description } = task;

  const total = parentTaskId === null ? 0 : 1;
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  switch (status) {
    case 'pending':
      completed = 0;
      break; // default: all counts 0
    case 'in_progress':
      completed = 0;
      break;
    case 'paused':
      completed = 0;
      break;
    case 'completed':
      completed = 1;
      break;
    case 'failed':
      failed = 1;
      break;
    case 'cancelled':
      skipped = 1;
      break;
  }

  const pending = total - completed - failed - skipped;

  // Invariant check: completed + failed + skipped must never exceed total (FR-6 + AC-7)
  if (completed + failed + skipped > total) {
    throw new TaskProgressInvariantError(completed, failed, skipped, total);
  }

  // Note: If the incoming task already had a broken invariant (server data inconsistency), we reject it.
  // This ensures the read path never returns invalid progress, satisfying AC-7 (reject partial progress data).

  const percentage =
    total === 0 ? 100 : Math.floor((completed / total) * 100);

  // Basic validation: ensure percentage is in range 0-100
  if (percentage < 0 || percentage > 100) {
    throw new TaskProgressInvariantError(completed, failed, skipped, total);
  }

  return {
    total,
    completed,
    failed,
    skipped,
    pending,
    percentage,
  };
}