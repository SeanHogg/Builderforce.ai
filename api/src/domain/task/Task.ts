/**
 * Task domain model and business logic for the Builderforce application.
 * - Defined in: api/src/domain/task/Task.ts
 */

/** Summary representation of a task's progress breakdown. */
export interface TaskProgress {
  /** Count of all sub-items (checklist items or sub-steps) belonging to this task. */
  total: number;

  /** Count of items in a terminal success state. */
  completed: number;

  /** Count of items in a terminal failure state without a pending retry. */
  failed: number;

  /** Count of items intentionally bypassed. */
  skipped: number;

  /** Count of items not yet started or actively in progress. */
  pending: number;

  /** Percentage of completion as an integer between 0 and 100. */
  percentage: number;
}

/** Main task entity representing a single unit of work. */
export interface Task {
  /** Unique identifier for the task. */
  id: string;

  /** Title of the task. */
  title: string;

  /** Detailed description or instructions for the task. */
  description: string | null;

  /** Current status of the task. */
  status: TaskStatus;

  /** Optional parent task this task is part of. */
  parentTaskId: string | null;

  /** Timestamp when the task was created. */
  createdAt: string;

  /** Timestamp when the task was last updated. */
  updatedAt: string;

  /** Completion progress for this task. */
  progress: TaskProgress;
}

/**
 * DTO used to create or update a task (data keyed by names that match API bodies).
 */
export interface CreateOrUpdateTaskDto {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  parentTaskId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Creates a new Task entity from raw data, computing progress server-side.
 *
 * @param raw - Raw task data
 * @returns Instantiated Task entity
 */
export function createTask(raw: CreateOrUpdateTaskDto): Task {
  // Normalize parentTaskId: null for atomic tasks.
  const parentTaskId = raw.parentTaskId ?? null;
  // Determine total: rooted tasks with parentTaskId=null have no explicit sub-items.
  const total = parentTaskId === null ? 0 : 1;

  // Derive completed/failed/skipped from the parent task's own status.
  const status = raw.status ?? TaskStatus.PENDING;
  const completed = status === TaskStatus.COMPLETED ? 1 : 0;
  const failed = status === TaskStatus.FAILED ? 1 : 0;
  const skipped = status === TaskStatus.CANCELLED ? 1 : 0;

  // pending is computed later in the controller/endpoint (see FR-3).
  const percentage = total === 0 ? 100 : Math.floor((completed / total) * 100);

  const now = new Date().toISOString();

  return {
    id: '', // Inject by the caller (repository saves).
    title: raw.title,
    description: raw.description ?? null,
    status: status,
    parentTaskId: parentTaskId,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
    progress: { total, completed, failed, skipped, pending: -1, percentage }, // pending will be corrected by the caller.
  };
}

/**
 * Reconstitutes an existing Task from storage or other external source.
 *
 * @param raw - Already-typed task data
 * @returns Instantiated Task entity
 */
export function reconstituteTask(raw: Task): Task {
  return raw;
}