/**
 * Task types specifically for the notification system and related utilities.
 */

/**
 * Task status enumeration
 */
export type TaskStatus = "pending" | "planning" | "running" | "waiting" | "completed" | "failed" | "cancelled";

/**
 * Base task properties common to all tasks
 */
export interface BaseTask {
  id: string;
  status: TaskStatus;
  description?: string;
  output?: string;
  error?: string;
  progress?: number;
  accountId?: string;
  taskType?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Task completion event - triggered when a task reaches the completed status
 */
export interface TaskCompletionEvent {
  task: BaseTask;
}

/**
 * Task update event - used for monitoring task changes
 */
export interface TaskUpdateEvent {
  taskId: string;
  status: TaskStatus;
  timestamp: Date;
  message?: string;
  progress?: number;
}

/**
 * Hen task-specific type - tasks categorized as "Hen" types
 */
export interface HenTask extends BaseTask {
  taskType: "Hen";
}

/**
 * Filter options for listing tasks
 */
export interface TaskListFilter {
  status?: TaskStatus;
  accountId?: string;
  taskType?: string;
}