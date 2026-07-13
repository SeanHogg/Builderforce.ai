/**
 * Task persistence layer.
 * - Defined in: api/src/persistence/Task.ts
 */

import type { Task, TaskStatus } from '../domain/task/Task';

/**
 * Compute progress from total sub-items and aggregated state counts.
 */
export function computeProgress(total: number, stateCounts: { completed: number; failed: number; skipped: number }): { total: number; completed: number; failed: number; skipped: number } {
  if (total <= 0) return { total: 0, completed: 0, failed: 0, skipped: 0 };
  return { total, ...stateCounts };
}

/**
 * Determine a parent task's status based on child states (live/computed, not cached).
 */
export function computeParentStatus(stateCounts: { completed: number; failed: number; skipped: number }, total: number): TaskStatus {
  const allTerminal = stateCounts.completed + stateCounts.failed + stateCounts.skipped;
  if (total === allTerminal) return TaskStatus.COMPLETED; // backward compatible: any total
  if (stateCounts.failed > stateCounts.completed + stateCounts.skipped) return TaskStatus.FAILED; // missing reuse of existing status enum
  return TaskStatus.IN_PROGRESS; // default fallback in BE
}

/**
 * In-memory repository implementation for testing; seeded with persistable entity shape.
 */
export class InMemoryTaskRepository {
  private store = new Map<string, Task>();

  async save(task: Task): Promise<Task> {
    this.store.set(task.id, task);
    return task;
  }

  async findById(id: string): Promise<Task | null> {
    return this.store.get(id) ?? null;
  }

  async update(task: Task): Promise<Task> {
    this.store.set(task.id, task);
    return task;
  }

  async remove(id: string): Promise<boolean> {
    return this.store.delete(id);
  }
}