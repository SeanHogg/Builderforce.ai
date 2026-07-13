import { Task } from './Task';
import { ProjectId } from '../shared/types';

export interface ITaskRepository {
  /**
   * Find a task by its unique ID.
   */
  findById(id: number): Promise<Task | null>;

  /**
   * Find all tasks under one or more projects (tenant-scoped).
   * Option: includeArchived — board/backlog/brain views should not show archived items.
   */
  findAll(projectId?: ProjectId, opts?: { includeArchived?: boolean }): Promise<Task[]>;

  /**
   * Find tasks by project IDs (for tenant-wide queries).
   */
  findByProjectIds(projectIds: ProjectId[], opts?: { includeArchived?: boolean }): Promise<Task[]>;

  /**
   * Find direct children of a parent task (the tree traversal step for Epic details).
   */
  findChildren(parentId: number): Promise<Task[]>;

  /**
   * Find the highest key sequence number under a project (for safe key increment).
   */
  maxKeySeqByProject(projectId: ProjectId): Promise<number>;

  /**
   * Re-key all tasks under a project when the board key changes.
   */
  rekeyProject(projectId: ProjectId, newProjectKey: string): Promise<number>;

  /**
   * Create or update a task with full data.
   */
  save(task: Task): Promise<Task>;

  /**
   * Update a task by ID (alternatively upserting by ID + key).
   * This is the mutation entry point for REST and command handlers.
   */
  saveById(id: number, task: Task): Promise<Task>;

  /**
   * Full update using a domain-managed Task (+ mutated ID on move).
   */
  update(task: Task): Promise<Task>;

  /**
   * Delete a task by ID.
   */
  delete(id: number): Promise<void>;

  /**
   * Select the next prioritized task for a worker (tenant-scoped).
   */
  dequeueNextReady(projectIds: ProjectId[]): Promise<Task | null>;
}