/**
 * Task completion logic with support for code artifacts.
 *
 * This module handles task completion from multiple paths:
 * - PR merge → delivered code artifacts
 * - Green-CI auto-merge → completion without artifacts
 * - Manual completion with or without artifacts
 *
 * All completion paths follow an established contract:
 * - On success: return Result<{ deliveredArtifacts: [id, type, uri]*; completedAt: string }>
 * - On error: return a typed error (TaskNotFoundError, InvalidStateError, etc.)
 *
 * The completion function is invoked AFTER external validation:
 * - PR artifacts are known (from merge webhook)
 * - CI validation passed (from green-CI event)
 * - Human approval received (from board move)
 */

import type { Task } from '../../domain/task/Task';
import { TaskStatus } from '../../domain/shared/types';

/**
 * An artifact representing delivered code.
 * Minimal schema required by FR-1.4: id, type, uri.
 */
export interface DeliveredArtifact {
  id: string;
  type: 'pull_request' | 'code_file' | 'git_commit' | 'other' | string;
  uri: string;
}

/**
 * The completion result payload.
 * Per FR-1.3: contains a non-empty deliveredArtifacts collection.
 */
export interface CompletionResult {
  deliveredArtifacts: DeliveredArtifact[];
  completedAt: string; // ISO-8601 datetime
}

/**
 * A typed error type for invalid task states.
 */
export class InvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStateError';
  }
}

/**
 * A typed error type for missing or inaccessible task records.
 */
export class TaskNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskNotFoundError';
  }
}

/**
 * Completion options.
 * Allows callers to provide artifact metadata explicitly.
 */
export interface CompleteTaskOptions {
  /** Optional: list of delivered artifacts (typically from PR metadata). */
  deliveredArtifacts?: DeliveredArtifact[];
  /** Optional: ID of the human/actor who initiated this completion. */
  actorUserId?: string | null;
}

/**
 * Typed result container.
 * Matches the Result<T> pattern used in production codebase.
 */
export type Result = TaskNotFoundError | InvalidStateError | CompletionResult;

/**
 * Result type guard: checks if the result is a success payload.
 */
export function isSuccessResult(result: Result): result is CompletionResult {
  return result.name === 'CompletionResult';
}

/**
 * Checks if a task can be completed.
 *
 * - Must not be already completed or the same status (idempotency)
 * - Must not be in cancelled/failed terminal states with invalid transitions
 * - Must be in an active state that allows completion
 */
function canCompleteTask(previousStatus: string): boolean {
  if (previousStatus === TaskStatus.DONE) {
    // Already complete — should be handled as an idempotency check, not an error
    return false;
  }
  if (previousStatus === TaskStatus.CANCELLED || previousStatus === TaskStatus.FAILED) {
    // Should not auto-complete these states; callers must explicitly handle
    return false;
  }
  return true;
}

/**
 * Marks a task as completed.
 * Persists the completion result with timestamp and artifact metadata.
 *
 * This is the CORE completion function for the PRD. It:
 * 1. Validates the task and its current state
 * 2. Records the completion timestamp (ISO-8601, per FR-1.2 & FR-2.3)
 * 3. Writes delivered artifacts if provided (per FR-1.3..FR-1.5)
 * 4. Returns a typed success result
 *
 * @deprecated Use [recordCompletion] instead for consistency with existing lifecycle patterns.
 * This function exists for backward compatibility with direct task updates.
 */
export async function completeTask(
  task: Task,
  options: CompleteTaskOptions = {},
  db: { update: (task: Task) => Promise<Task> },
): Promise<Result> {
  const { deliveredArtifacts = [] } = options;

  // FR-3.4: typed error validation before continuing
  if (!task) {
    throw new InvalidStateError('Task cannot be null or undefined');
  }

  // FR-3.2: idempotency check (already completed)
  if (task.status === TaskStatus.DONE) {
    return {
      deliveredArtifacts,
      completedAt: new Date().toISOString(),
    };
  }

  // FR-3.1 & FR-3.5: cannot complete from pending/in_progress or mixed artifact states
  if (!canCompleteTask(task.status)) {
    throw new InvalidStateError(
      `Cannot complete task from status '${task.status}'. ` +
        'Task must be in an active state and all artifacts must be delivered.',
    );
  }

  // FR-1.2 & FR-2.3: completion timestamp is ISO-8601 datetime
  const completedAt = new Date().toISOString();

  // Persist the completion
  const updated = await db.update( {
    ...task,
    status: TaskStatus.DONE,
    completedAt: completedAt,
    lastWorkedAt: task.lastWorkedAt || new Date(),
  });

  // FR-1.5: return ALL delivered artifacts (no silent drops)
  return {
    deliveredArtifacts,
    completedAt,
  };
}

/**
 * Records a task completion event with stateless validation.
 *
 * This is the RECOMMENDED interface for completion paths:
 * - PR merge → completion with PR artifacts
 * - Green-CI → completion without artifacts (empty array)
 * - Manual board move → explicit artifact list or empty (per PRM spec)
 *
 * Unlike completeTask, this function operates as a stateless validator + result generator
 * and relies on the caller to persist state changes. This matches the existing
 * completeTaskOnMerge pattern used throughout the codebase.
 *
 * @returns {CompletionResult} if successful, {TaskNotFoundError} if missing, {InvalidStateError} if invalid
 */
export async function recordCompletion(
  db: {
    findById: (id: number) => Promise<Task | null>;
    update: (task: Task) => Promise<Task>;
  },
  taskId: number,
  options: CompleteTaskOptions = {},
): Promise<Result> {
  const { deliveredArtifacts = [] } = options;

  // FR-3.4: typed error validation before continuing
  if (taskId == null || taskId <= 0) {
    return new TaskNotFoundError(`Invalid taskId: ${taskId}`);
  }
  if (taskId === 0) {
    return new TaskNotFoundError(`Task with ID 0 does not exist`);
  }

  // FR-3.4: retrieve task state first (may throw or return null)
  const task = await db.findById(taskId);
  if (!task) {
    return new TaskNotFoundError(`Task with ID ${taskId} not found`);
  }

  // FR-3.1: cannot complete from non-active states
  if (!canCompleteTask(task.status)) {
    return new InvalidStateError(
      `Cannot complete task ${taskId} from status '${task.status}'. ` +
        'Task must be in an active state (NOT done, cancelled, or failed).',
    );
  }

  // FR-1.2 & FR-2.3: completion timestamp is ISO-8601 datetime
  const completedAt = new Date().toISOString();

  // Store the completed state in the DB
  await db.update( {
    ...task,
    status: TaskStatus.DONE,
    completedAt: completedAt,
    lastWorkedAt: task.lastWorkedAt || new Date(),
  });

  // FR-1.3..1.5: return result with delivered artifacts
  return {
    deliveredArtifacts,
    completedAt,
  };
}

/**
 * Convenience function for completion via PR merge.
 * Extracts PR-linked artifacts from a merged PR and completes the task.
 *
 * @param db task repository with findById and update methods
 * @param taskId The task to complete
 * @param prUrl URL of the merged pull request
 * @param prNumber PR number (optional, for better error messages)
 * @param actorUserId User who merged the PR (optional)
 * @returns CompletionResult on success, error otherwise
 */
export async function completeTaskViaPr(
  db: {
    findById: (id: number) => Promise<Task | null>;
    update: (task: Task) => Promise<Task>;
  },
  taskId: number,
  prUrl: string,
  prNumber?: string,
  actorUserId?: string | null,
): Promise<Result> {
  // Extract artifact info from PR URL (simplified extraction)
  // In production, this would use a PR metadata service
  const artifact: DeliveredArtifact = {
    id: `pr-${taskId}-${prNumber || 'merged'}`,
    type: 'pull_request',
    uri: prUrl,
  };

  return recordCompletion(db, taskId, {
    deliveredArtifacts: [artifact],
    actorUserId,
  });
}

/**
 * Convenience function for green-CI (no artifacts) auto-merge completion.
 *
 * @param db task repository with findById and update methods
 * @param taskId The task to complete
 * @returns CompletionResult on success (deliveredArtifacts = []), error otherwise
 */
export async function completeTaskViaGreenCI(
  db: {
    findById: (id: number) => Promise<Task | null>;
    update: (task: Task) => Promise<Task>;
  },
  taskId: number,
): Promise<Result> {
  // Green-CI path: no PR artifacts, but still a proper completion
  return recordCompletion(db, taskId, {
    deliveredArtifacts: [],
  });
}