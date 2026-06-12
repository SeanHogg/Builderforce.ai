/**
 * Enhanced task engine for distributed task lifecycle
 * Supports globally unique task IDs, persistence, resumability
 */

import crypto from "node:crypto";
// Assuming TaskState and TaskStatus are imported from './types.js'
// and TaskSubmitRequest is also defined there or globally.
// For this modification, we'll extend TaskState with new fields.
// import type { TaskState, TaskStatus, TaskSubmitRequest, TaskUpdateEvent } from "./types.js";

// --- Start of Modified/Added Types ---
// Assuming original TaskState and TaskStatus are defined elsewhere and imported.
// We define an extended interface here for clarity.
interface TaskState {
  id: string;
  agentId?: string;
  sessionId?: string;
  parentTaskId?: string;
  status: TaskStatus; // From original types/interface
  description?: string;
  output?: string;
  error?: string;
  progress?: number;
  metadata?: Record<string, any>;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;

  // New fields for Hen task notification
  accountId?: string; // To associate task with an account
  taskType?: string; // To identify task type, e.g., 'Hen'
}

// Assuming TaskStatus is a string literal type like:
// type TaskStatus = "pending" | "planning" | "running" | "waiting" | "completed" | "failed" | "cancelled";

// Assuming TaskSubmitRequest has fields like agentId, description, sessionId, parentTaskId, metadata
// We'll extend it implicitly by passing new fields in createTask's request parameter.
interface TaskSubmitRequest {
  agentId?: string;
  sessionId?: string;
  parentTaskId?: string;
  description?: string;
  metadata?: Record<string, any>;
  // New fields for Hen task notification
  accountId?: string;
  taskType?: string;
}

// Task event types (assuming these are already defined)
type TaskEvent = {
  taskId: string;
  timestamp: Date;
  event: "created" | "status_changed" | "progress_updated" | "output_added" | "error_set";
  oldStatus?: TaskStatus;
  newStatus?: TaskStatus;
  message?: string;
  data?: unknown;
};

// Task update event type for listeners (assuming this is already defined)
type TaskUpdateEvent = {
  taskId: string;
  status: TaskStatus;
  timestamp: Date;
  message?: string;
  progress?: number;
};

// Task storage interface (assuming this is already defined)
export interface TaskStorage {
  save(task: TaskState): Promise<void>;
  load(taskId: string): Promise<TaskState | null>;
  list(filter?: { status?: TaskStatus; sessionId?: string }): Promise<TaskState[]>;
  delete(taskId: string): Promise<void>;
  saveEvent(event: TaskEvent): Promise<void>;
  getEvents(taskId: string): Promise<TaskEvent[]>;
}
// --- End of Modified/Added Types ---


/**
 * Validate if a status transition is allowed
 */
function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  // Assuming VALID_TRANSITIONS is defined elsewhere or globally
  const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    pending: ["planning", "cancelled"],
    planning: ["running", "failed", "cancelled"],
    running: ["waiting", "completed", "failed", "cancelled"],
    waiting: ["running", "failed", "cancelled"],
    failed: [],
    completed: [],
    cancelled: [],
  };
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * In-memory task storage implementation (assuming this is already defined)
 */
export class MemoryTaskStorage implements TaskStorage {
  private tasks = new Map<string, TaskState>();
  private events = new Map<string, TaskEvent[]>();

  async save(task: TaskState): Promise<void> {
    this.tasks.set(task.id, { ...task });
  }

  async load(taskId: string): Promise<TaskState | null> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  async list(filter?: { status?: TaskStatus; sessionId?: string }): Promise<TaskState[]> {
    let tasks = Array.from(this.tasks.values());

    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }

    if (filter?.sessionId) {
      tasks = tasks.filter((t) => t.sessionId === filter.sessionId);
    }

    return tasks.map((t) => ({ ...t }));
  }

  async delete(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
    this.events.delete(taskId);
  }

  async saveEvent(event: TaskEvent): Promise<void> {
    const events = this.events.get(event.taskId) || [];
    events.push(event);
    this.events.set(event.taskId, events);
  }

  async getEvents(taskId: string): Promise<TaskEvent[]> {
    return this.events.get(taskId) || [];
  }
}

/**
 * Helper to check if a task is a 'Hen' task
 */
function isHenTask(task: TaskState | null): boolean {
  return task?.taskType === 'Hen';
}

/**
 * Helper to check if all 'Hen' tasks for an account are completed.
 * Assumes task.accountId and task.taskType fields exist on TaskState.
 */
async function areAllHenTasksCompleted(storage: TaskStorage, accountId: string): Promise<boolean> {
  const henTasks = await storage.list({ status: undefined, sessionId: undefined }); // Get all tasks
  const accountHenTasks = henTasks.filter(
    (t) => t.accountId === accountId && isHenTask(t)
  );

  // If there are no Hen tasks for this account, consider it completed (or handle as per requirements)
  if (accountHenTasks.length === 0) {
    return true;
  }

  // Check if all found Hen tasks are completed
  return accountHenTasks.every((t) => t.status === "completed");
}

/**
 * Import the notification service
 */
// NOTE: Assuming '../services/notificationService' is the correct path and export.
// If the path is different, this import needs to be adjusted.
import { sendHenTaskCompletionEmail } from '../services/notificationService';


/**
 * Enhanced task engine with distributed capabilities
 */
export class DistributedTaskEngine {
  private storage: TaskStorage;
  private updateListeners = new Map<string, Set<(event: TaskUpdateEvent) => void>>();

  constructor(storage?: TaskStorage) {
    this.storage = storage || new MemoryTaskStorage();
  }

  /**
   * Create a new task with globally unique ID
   * Modified to accept accountId and taskType
   */
  async createTask(request: TaskSubmitRequest): Promise<TaskState> {
    const task: TaskState = {
      id: crypto.randomUUID(),
      status: "pending",
      agentId: request.agentId,
      description: request.description,
      sessionId: request.sessionId,
      parentTaskId: request.parentTaskId,
      createdAt: new Date(),
      metadata: request.metadata,
      // Assign new fields if provided
      accountId: request.accountId,
      taskType: request.taskType,
    };

    await this.storage.save(task);
    await this.recordEvent({
      taskId: task.id,
      timestamp: new Date(),
      event: "created",
      newStatus: "pending",
      message: "Task created",
      data: { accountId: task.accountId, taskType: task.taskType } // Log added fields
    });

    return task;
  }

  /**
   * Update task status with validation
   * Modified to check for Hen task completion and trigger email notification.
   */
  async updateTaskStatus(taskId: string, newStatus: TaskStatus): Promise<TaskState | null> {
    const task = await this.storage.load(taskId);
    if (!task) {
      return null;
    }

    // Validate transition
    if (!isValidTransition(task.status, newStatus)) {
      throw new Error(
        `Invalid status transition from ${task.status} to ${newStatus} for task ${taskId}`,
      );
    }

    const oldStatus = task.status;
    task.status = newStatus;

    // Update timestamps
    if (newStatus === "planning" || newStatus === "running") {
      task.startedAt = task.startedAt || new Date();
    }

    if (newStatus === "completed" || newStatus === "failed" || newStatus === "cancelled") {
      task.completedAt = new Date();
    }

    await this.storage.save(task);
    await this.recordEvent({
      taskId,
      timestamp: new Date(),
      event: "status_changed",
      oldStatus,
      newStatus,
      message: `Status changed from ${oldStatus} to ${newStatus}`,
    });

    // --- HEN TASK COMPLETION LOGIC ---
    if (newStatus === "completed" && isHenTask(task) && task.accountId) {
      const allCompleted = await areAllHenTasksCompleted(this.storage, task.accountId);
      if (allCompleted) {
        // All Hen tasks for this account are now complete, send notification
        await sendHenTaskCompletionEmail(task.accountId);
      }
    }
    // --- END HEN TASK COMPLETION LOGIC ---


    // Notify listeners
    this.notifyListeners(taskId, {
      taskId,
      status: newStatus,
      timestamp: new Date(),
      message: `Status changed to ${newStatus}`,
    });

    return task;
  }

  /**
   * Update task progress (existing method)
   */
  async updateTaskProgress(taskId: string, progress: number): Promise<TaskState | null> {
    const task = await this.storage.load(taskId);
    if (!task) {
      return null;
    }

    task.progress = Math.min(100, Math.max(0, progress));
    await this.storage.save(task);
    await this.recordEvent({
      taskId,
      timestamp: new Date(),
      event: "progress_updated",
      data: { progress },
    });

    this.notifyListeners(taskId, {
      taskId,
      status: task.status,
      timestamp: new Date(),
      progress,
    });

    return task;
  }

  /**
   * Set task output (existing method)
   */
  async setTaskOutput(taskId: string, output: string): Promise<TaskState | null> {
    const task = await this.storage.load(taskId);
    if (!task) {
      return null;
    }

    task.output = output;
    await this.storage.save(task);
    await this.recordEvent({
      taskId,
      timestamp: new Date(),
      event: "output_added",
      data: { outputLength: output.length },
    });

    return task;
  }

  /**
   * Set task error (existing method)
   */
  async setTaskError(taskId: string, error: string): Promise<TaskState | null> {
    const task = await this.storage.load(taskId);
    if (!task) {
      return null;
    }

    task.error = error;
    task.status = "failed";
    task.completedAt = new Date();

    await this.storage.save(task);
    await this.recordEvent({
      taskId,
      timestamp: new Date(),
      event: "error_set",
      newStatus: "failed",
      data: { error },
    });

    this.notifyListeners(taskId, {
      taskId,
      status: "failed",
      timestamp: new Date(),
      message: error,
    });

    return task;
  }

  /**
   * Get task state (existing method)
   */
  async getTask(taskId: string): Promise<TaskState | null> {
    return this.storage.load(taskId);
  }

  /**
   * List tasks with optional filter (existing method)
   * This method is crucial for `areAllHenTasksCompleted` to work correctly.
   * Ensure it correctly retrieves tasks from storage.
   */
  async listTasks(filter?: { status?: TaskStatus; sessionId?: string }): Promise<TaskState[]> {
    // This method is assumed to be correctly implemented in TaskStorage.
    // If the storage's list method doesn't return all tasks by default (without filter),
    // `areAllHenTasksCompleted` will need to be adjusted.
    // For now, assuming the storage.list() call inside `areAllHenTasksCompleted` works as intended.
    return this.storage.list(filter);
  }

  /**
   * Get task event history (existing method)
   */
  async getTaskEvents(taskId: string): Promise<TaskEvent[]> {
    return this.storage.getEvents(taskId);
  }

  /**
   * Cancel a task (existing method)
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const task = await this.storage.load(taskId);
    if (!task) {
      return false;
    }

    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      return false; // Already in terminal state
    }

    await this.updateTaskStatus(taskId, "cancelled");
    return true;
  }

  /**
   * Subscribe to task updates (existing method)
   */
  subscribeToTask(taskId: string, callback: (event: TaskUpdateEvent) => void): () => void {
    const listeners = this.updateListeners.get(taskId) || new Set();
    listeners.add(callback);
    this.updateListeners.set(taskId, listeners);

    // Return unsubscribe function
    return () => {
      const currentListeners = this.updateListeners.get(taskId);
      if (currentListeners) {
        currentListeners.delete(callback);
      }
    };
  }

  /**
   * Stream task updates as async iterator (existing method)
   */
  async *streamTaskUpdates(taskId: string): AsyncIterableIterator<TaskUpdateEvent> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Yield initial state
    yield {
      taskId,
      status: task.status,
      timestamp: new Date(),
      progress: task.progress,
    };

    // Set up listener for future updates
    const updates: TaskUpdateEvent[] = [];
    let resolve: (() => void) | null = null;

    const unsubscribe = this.subscribeToTask(taskId, (event) => {
      updates.push(event);
      if (resolve) {
        resolve();
        resolve = null;
      }
    });

    try {
      // Stream updates until task is in terminal state
      while (true) {
        const currentTask = await this.getTask(taskId);
        if (!currentTask) {
          break;
        }

        if (
          currentTask.status === "completed" ||
          currentTask.status === "failed" ||
          currentTask.status === "cancelled"
        ) {
          // Yield any remaining updates
          while (updates.length > 0) {
            yield updates.shift()!;
          }
          break;
        }

        if (updates.length > 0) {
          yield updates.shift()!;
        } else {
          // Wait for next update
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
      }
    } finally {
      unsubscribe();
    }
  }

  /**
   * Record an event in the audit log (existing method)
   */
  private async recordEvent(event: TaskEvent): Promise<void> {
    await this.storage.saveEvent(event);
  }

  /**
   * Notify all listeners of an update (existing method)
   */
  private notifyListeners(taskId: string, event: TaskUpdateEvent): void {
    const listeners = this.updateListeners.get(taskId);
    if (listeners) {
      for (const callback of listeners) {
        callback(event);
      }
    }
  }
}

/**
 * Global task engine instance (assuming this is already defined)
 */
export const globalTaskEngine = new DistributedTaskEngine();
