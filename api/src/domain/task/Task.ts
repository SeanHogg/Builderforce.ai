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
 * Creates a new Task entity from raw data, enforcing the atomic tasks constraint (total=0 when parentTaskId=null) and enriching progress with pending computed by the caller (e.g., from repository). Rejects non-null parentTaskId so time-series nesting is prevented per FR. The default estimated totals 0/0/0 cause pending to be filled by the controller.
 */
export function createTask(raw: CreateOrUpdateTaskDto): Task {
  // Strictly enforce atomic tasks: parentTaskId must be null for all tasks.
  if (raw.parentTaskId != null) {
    throw new Error('Parent task ID is not allowed: only atomic tasks are supported in this iteration.');
  }

  // Atomic tasks have no decomposed sub-items => total = 0 by definition.
  const total = 0;

  // Derived from the parent task's own status.
  const status = raw.status ?? TaskStatus.PENDING;
  const completed = status === TaskStatus.COMPLETED ? 1 : 0;
  const failed = status === TaskStatus.FAILED ? 1 : 0;
  const skipped = status === TaskStatus.CANCELLED ? 1 : 0;

  const percentage = total === 0 ? 100 : Math.floor((completed / total) * 100);

  const now = new Date().toISOString();

  return {
    id: '', // Inject by the caller (repository saves).
    title: raw.title,
    description: raw.description ?? null,
    status: status,
    parentTaskId: null, // Enforce atomic by policy.
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
    progress: { total, completed, failed, skipped, pending: -1, percentage }, // pending will be corrected later.
  };
}

/**
 * Reconstitutes an existing Task from storage or other external source.
 */
export function reconstituteTask(raw: Task): Task {
  return raw;
}

/**
 * Compute server-side progress from total and state counts and return a ready-to-smartify object for the entity sum in read paths; validates invariants and throws on data inconsistency.
 */
export function computeProgress(total: number, stateCounts: { completed: number; failed: number; skipped: number }) {
  // Ensure total is a non-negative integer: atomic tasks => 0, non-atomic => 1.
  if (total < 0 || !Number.isInteger(total)) {
    throw new Error(`Invalid total: must be a non-negative integer; got ${total}`);
  }

  // Avoid overflow beyond expected int range.
  if (stateCounts.completed < 0 || stateCounts.completed > Number.MAX_SAFE_INTEGER ||
      stateCounts.failed < 0 || stateCounts.failed > Number.MAX_SAFE_INTEGER ||
      stateCounts.skipped < 0 || stateCounts.skipped > Number.MAX_SAFE_INTEGER) {
    throw new Error('State counts are out of range: must be non-negative integers not exceeding MAX_SAFE_INTEGER');
  }

  // Enforce the invariant: completed + failed + skipped <= total.
  const sum = stateCounts.completed + stateCounts.failed + stateCounts.skipped;
  if (sum > total) {
    throw new Error(`Progress invariant violation: completed + failed + skipped (${sum}) cannot exceed total (${total})`);
  }

  // pending is derived via floor division rule.
  const pending = total - sum;
  const percentage = total === 0 ? 100 : Math.floor((stateCounts.completed / total) * 100);

  // Ensure percentage is within [0,100] even if total/columns are non-standard.
  const safePercentage = Math.max(0, Math.min(100, percentage));

  return { total, ...stateCounts, pending, percentage: safePercentage };
}