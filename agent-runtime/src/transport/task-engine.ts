/**
 * Enhanced task engine for distributed task lifecycle
 * Supports globally unique task IDs, persistence, resumability
 */

import crypto from "node:crypto";
import type { TaskState, TaskStatus, TaskSubmitRequest, TaskUpdateEvent } from "./types.js";

/**
 * Task transition rules based on state machine
 */
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["planning", "cancelled"],
  planning: ["running", "failed", "cancelled"],
  running: ["waiting", "completed", "failed", "cancelled"],
  waiting: ["running", "failed", "cancelled"],
  failed: [],
  completed: [],
  cancelled: [],
};

/**
 * Validate if a status transition is allowed
 */
function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Task event for audit log
 */
export type TaskEvent = {
  taskId: string;
  timestamp: Date;
  event: "created" | "status_changed" | "progress_updated" | "output_added" | "error_set";
  oldStatus?: TaskStatus;
  newStatus?: TaskStatus;
  message?: string;
  data?: unknown;
};

/**
 * Task storage interface for persistence
 */
export interface TaskStorage {
  save(task: TaskState): Promise<void>;
  load(taskId: string): Promise<TaskState | null>;
  list(filter?: { status?: TaskStatus; sessionId?: string }): Promise<TaskState[]>;
  delete(taskId: string): Promise<void>;
  saveEvent(event: TaskEvent): Promise<void>;
  getEvents(taskId: string): Promise<TaskEvent[]>;
}

/**
 * In-memory task storage implementation
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
    };

    await this.storage.save(task);
    await this.recordEvent({
      taskId: task.id,
      timestamp: new Date(),
      event: "created",
      newStatus: "pending",
      message: "Task created",
    });

    return task;
  }

  /**
   * Update task status with validation
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
   * Update task progress
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
   * Set task output
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
   * Set task error
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
   * Get task state
   */
  async getTask(taskId: string): Promise<TaskState | null> {
    return this.storage.load(taskId);
  }

  /**
   * List tasks with optional filter
   */
  async listTasks(filter?: { status?: TaskStatus; sessionId?: string }): Promise<TaskState[]> {
    return this.storage.list(filter);
  }

  /**
   * Get task event history
   */
  async getTaskEvents(taskId: string): Promise<TaskEvent[]> {
    return this.storage.getEvents(taskId);
  }

  /**
   * Cancel a task
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
   * Subscribe to task updates
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
   * Stream task updates as async iterator
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
   * Record an event in the audit log
   */
  private async recordEvent(event: TaskEvent): Promise<void> {
    await this.storage.saveEvent(event);
  }

  /**
   * Notify all listeners of an update
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
 * Global task engine instance
 */
export const globalTaskEngine = new DistributedTaskEngine();
