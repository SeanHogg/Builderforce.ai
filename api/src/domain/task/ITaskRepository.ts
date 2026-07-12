import { Task } from './Task';
import { TaskId, ProjectId } from '../shared/types';

/** Options common to the list/read paths. */
export interface TaskListOptions {
  /** Include archived tasks (default false — the board/backlog hide archived). */
  includeArchived?: boolean;
}

/**
 * Persistence port for the Task aggregate. The application layer depends on this
 * interface only; concrete adapters (Postgres/Drizzle, in-memory test fakes) live
 * in the infrastructure layer.
 */
export interface ITaskRepository {
  findAll(projectId?: ProjectId, opts?: TaskListOptions): Promise<Task[]>;
  findByProjectIds(ids: ProjectId[], opts?: TaskListOptions): Promise<Task[]>;
  findById(id: TaskId): Promise<Task | null>;
  /** Direct child tasks of an Epic (parent_task_id = parentId), oldest first. */
  findChildren(parentId: TaskId): Promise<Task[]>;
  /**
   * Highest existing task-key sequence number in a project (0 if none). Keys are
   * minted off this (not a row count) so deletes/moves never cause a collision.
   */
  maxKeySeqByProject(projectId: ProjectId): Promise<number>;
  /** Re-prefix every numeric-suffix key in a project to a new project key. */
  rekeyProject(projectId: ProjectId, newProjectKey: string): Promise<number>;
  save(task: Task): Promise<Task>;
  update(task: Task): Promise<Task>;
  delete(id: TaskId): Promise<void>;
  /** Atomically claim the next READY task across the given projects, or null. */
  dequeueNextReady(projectIds: ProjectId[]): Promise<Task | null>;
}
