/**
 * FR6: Low-priority task status management
 *
 * Provide status actions for low-priority tasks:
 * - Mark task as "On Hold"
 * - Mark task as "Deferred"
 *
 * Updates to a task's status to reflect temporary de-emphasis.
 *
 * Status values for low-priority tasks:
 * - on_hold: temporarily paused
 * - deferred: postponed to future
 * - (existing: backlog | todo | ready | in_progress | in_review | done | blocked)
 */

export type LowPriorityStatus =
  | 'on_hold'
  | 'deferred'
  | 'backlog'
  | 'todo'
  | 'ready'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'blocked';

export interface PriorityStatusUpdate {
  taskId: number;
  newStatus: LowPriorityStatus;
  note?: string;
  timestamp: string;
}

/**
 * Status management service for low-priority tasks
 */
export class PriorityStatusService {
  /**
   * Mark a task as on_hold
   */
  static async setStatusOnHold(
    taskId: number,
    note?: string
  ): Promise<PriorityStatusUpdate> {
    return this.updateStatus(taskId, 'on_hold', note);
  }

  /**
   * Mark a task as deferred
   */
  static async setStatusDeferred(
    taskId: number,
    note?: string
  ): Promise<PriorityStatusUpdate> {
    return this.updateStatus(taskId, 'deferred', note);
  }

  /**
   * Get current status for a task
   */
  static async getTaskStatus(taskId: number): Promise<{
    taskId: number;
    currentStatus: LowPriorityStatus;
    priority: 'high' | 'medium' | 'low';
    canSetOnHold: boolean;
    canSetDeferred: boolean;
  }> {
    // Simulated task fetch
    const tasks = await this.mockFetchTask(taskId);
    return {
      taskId,
      currentStatus: tasks.status,
      priority: tasks.priority,
      canSetOnHold: tasks.priority === 'low' || tasks.priority === 'medium',
      canSetDeferred: tasks.priority === 'low' || tasks.priority === 'medium',
    };
  }

  private static async updateStatus(
    taskId: number,
    newStatus: LowPriorityStatus,
    note?: string
  ): Promise<PriorityStatusUpdate> {
    console.log(`[PriorityStatus] Updating task ${taskId} to ${newStatus}`, note);

    return {
      taskId,
      newStatus,
      note,
      timestamp: new Date().toISOString(),
    };
  }

  private static async mockFetchTask(taskId: number): Promise<{
    id: number;
    status: string;
    priority: 'high' | 'medium' | 'low';
  }> {
    // Simulated DB fetch
    return new Promise((resolve) => {
      setTimeout(
        () =>
          resolve({
            id: taskId,
            status: 'backlog',
            priority: 'medium',
          }),
        30
      );
    });
  }
}