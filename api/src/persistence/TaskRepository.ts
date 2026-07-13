/**
 * Repository interface for task persistence abstractions.
 * Defined in: api/src/persistence/TaskRepository.ts
 */

import type { Task } from '../domain/task/Task';

/**
 * Repository abstracting task storage.
 * Implementations may use SQL, NoSQL, or in-memory storage.
 */
export interface ITaskRepository {
  /**
   * Retrieves a single task by its unique identifier.
   * @param id Task ID to fetch
   * @returns Task if found; otherwise throws TaskNotFoundError
   */
  getById(id: string): Promise<Task>;

  /**
   * Persists a task to storage, creating it if it does not exist.
   * @param task Task to store
   * @returns The persisted task (potentially with auto-generated IDs/timestamps)
   */
  save(task: Task): Promise<Task>;

  /**
   * Updates an existing task.
   * @param task Task to update (must contain ID)
   * @returns The updated task
   */
  update(task: Task): Promise<Task>;

  /**
   * Optional: Supports searching tasks by query and paging.
   */
  search(params: SearchParams): Promise<Task[]>;

  /**
   * Optional: Deletes a task and associated data.
   */
  delete(id: string): Promise<void>;
}

/**
 * Search parameters for task queries.
 */
export interface SearchParams {
  /**
   * Optional parent task filter.
   */
  parentTaskId?: string;
  /**
   * Optional status filters.
   */
  status?: Array<'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'paused'>;
  /**
   * Optional title substring search.
   */
  titleContains?: string;
  /**
   * Pagination offset.
   */
  offset?: number;
  /**
   * Pagination limit (max items).
   */
  limit?: number;
}

/**
 * Repository error types.
 */
export class TaskRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, TaskRepositoryError.prototype);
  }
}