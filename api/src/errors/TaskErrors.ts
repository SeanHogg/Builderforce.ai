/**
 * Application-layer errors specific to tasks.
 * Defined in: api/src/errors/TaskErrors.ts
 */

/**
 * Enumeration of task-specific error names.
 */
export enum TaskErrorNames {
  /**
   * Task not found in the repository.
   */
  NOT_FOUND = 'TASK_NOT_FOUND',

  /**
   * Attempt to manipulate a task that cannot be edited.
   */
  NOT_EDITABLE = 'TASK_NOT_EDITABLE',

  /**
   * Invalid operation due to task lifecycle constraints.
   */
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',

  /**
   * Reported progress invariant violation: completed + failed + skipped > total.
   */
  PROGRESS_INVARIANT_VIOLATION = 'PROGRESS_INVARIANT_VIOLATION',

  /**
   * Invalid task status supplied in input.
   */
  INVALID_STATUS = 'INVALID_STATUS',
}

/**
 * Base class for task-related errors.
 */
export class TaskError extends Error {
  public readonly name: string;
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  constructor(name: string, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = name;
    this.code = name;
    this.context = context;
    Object.setPrototypeOf(this, TaskError.prototype);
  }
}

/**
 * Raised when a task with the given ID does not exist.
 */
export class TaskNotFoundError extends TaskError {
  constructor(taskId: string) {
    super(TaskErrorNames.NOT_FOUND, `Task ${taskId} not found`, { taskId });
    Object.setPrototypeOf(this, TaskNotFoundError.prototype);
  }
}

/**
 * Raised when attempting to modify a task that is not editable (read-only).
 */
export class TaskNotEditableError extends TaskError {
  constructor(taskId: string) {
    super(TaskErrorNames.NOT_EDITABLE, `Task ${taskId} is not editable`, { taskId });
    Object.setPrototypeOf(this, TaskNotEditableError.prototype);
  }
}

/**
 * Raised when an invalid status transition is attempted.
 */
export class TaskInvalidStateTransitionError extends TaskError {
  constructor(expected?: TaskStatus, actual?: TaskStatus) {
    const message =
      actual === undefined
        ? 'Task cannot transition to current state'
        : `Task cannot transition from ${expected} to ${actual}`;
    super(TaskErrorNames.INVALID_STATE_TRANSITION, message, { expected, actual });
    Object.setPrototypeOf(this, TaskInvalidStateTransitionError.prototype);
  }
}

/**
 * Raised when the progress invariant is violated: completed + failed + skipped should never exceed total.
 */
export class TaskProgressInvariantError extends TaskError {
  constructor(completed: number, failed: number, skipped: number, total: number) {
    const sum = completed + failed + skipped;
    super(
      TaskErrorNames.PROGRESS_INVARIANT_VIOLATION,
      `Progress invariant violation: completed (${completed}) + failed (${failed}) + skipped (${skipped}) must be <= total (${total})`,
      { completed, failed, skipped, total, sum },
    );
    Object.setPrototypeOf(this, TaskProgressInvariantError.prototype);
  }
}

/**
 * Raised when an invalid status value is provided.
 */
export class TaskInvalidStatusError extends TaskError {
  constructor(status?: string) {
    super(TaskErrorNames.INVALID_STATUS, `Invalid task status: ${status ?? 'none provided'}`, { status });
    Object.setPrototypeOf(this, TaskInvalidStatusError.prototype);
  }
}

/**
 * Retryable wrapper for errors to indicate idempotent HTTP 404 state.
 */
export interface RetryableError extends Error {
  readonly isRetryable: true;
}

/**
 * Helper to classify if an error is retryable.
 */
export function isRetryableError(err: unknown): err is RetryableError {
  return (err as RetryableError).isRetryable === true;
}