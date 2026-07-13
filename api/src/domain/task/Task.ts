/**
 * Task domain model and business logic for the Builderforce application.
 * - Defined in: api/src/domain/task/Task.ts
 */

/**
 * Task statuses representing the lifecycle state of a task.
 */
export enum TaskStatus {
  /**
   * Initial state when a task is created but not yet started.
   */
  PENDING = 'pending',

  /**
   * Task is currently being executed (active work in progress).
   */
  IN_PROGRESS = 'in_progress',

  /**
   * Task has been paused or suspended. Associated resources may remain active.
   */
  PAUSED = 'paused',

  /**
   * Task has reached a terminal success state.
   */
  COMPLETED = 'completed',

  /**
   * Task has reached a terminal failure state.
   */
  FAILED = 'failed',

  /**
   * Task is deprecated due to expired time, duplicate, or external cancellation.
   */
  CANCELLED = 'cancelled',
}

/**
 * Summary representation of a task's progress breakdown.
 */
export interface TaskProgress {
  /**
   * Count of all sub-items (checklist items or sub-steps) belonging to this task.
   */
  total: number;

  /**
   * Count of items in a terminal success state.
   */
  completed: number;

  /**
   * Count of items in a terminal failure state without a pending retry.
   */
  failed: number;

  /**
   * Count of items intentionally bypassed.
   */
  skipped: number;

  /**
   * Count of items not yet started or actively in progress.
   * Computed as `total - completed - failed - skipped`.
   */
  pending: number;

  /**
   * Percentage of completion as an integer between 0 and 100.
   * Computed server-side as `floor((completed / total) * 100)`.
   * When `total = 0`, this is `100`.
   */
  percentage: number;
}

/**
 * Main task entity representing a single unit of work.
 */
export interface Task {
  /**
   * Unique identifier for the task.
   */
  id: string;

  /**
   * Title of the task.
   */
  title: string;

  /**
   * Detailed description or instructions for the task.
   */
  description: string | null;

  /**
   * Current status of the task.
   */
  status: TaskStatus;

  /**
   * Optional parent task this task is part of.
   */
  parentTaskId: string | null;

  /**
   * Completion progress for this task.
   */
  progress: TaskProgress;

  /**
   * Timestamp when the task was created.
   */
  createdAt: Date;

  /**
   * Timestamp when the task was last updated.
   */
  updatedAt: Date;
}

/**
 * Creates a new Task entity from raw data.
 *
 * @param raw - Raw task data
 * @returns Instantiated Task entity
 */
export function createTask(raw: Omit<Task, 'createdAt' | 'updatedAt' | 'progress'>): Task {
  const total = raw.parentTaskId === null ? 1 : 0;

  const progress: TaskProgress = {
    total,
    completed: raw.status === TaskStatus.COMPLETED ? 1 : 0,
    failed: (() => {
      if (raw.status === TaskStatus.FAILED) return 1;
      return 0;
    })(),
    skipped: raw.status === TaskStatus.CANCELLED ? 1 : 0,
    pending: raw.status === TaskStatus.PENDING || raw.status === TaskStatus.IN_PROGRESS ? 1 : 0,
    percentage: total === 0 ? 100 : Math.floor((progress.completed / total) * 100),
  };

  const now = new Date();
  return {
    ...raw,
    progress,
    createdAt: now,
    updatedAt: now,
  };
}