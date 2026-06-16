import { Task } from './Task';
import { TaskId, ProjectId } from '../shared/types';

/** List options shared by the task-listing queries. */
export interface TaskListOptions {
  /**
   * Include archived tasks in the result. Defaults to false: archived tasks are
   * removed from the board/backlog and the brain's list view, and are only
   * surfaced where the archive itself is the subject (e.g. project deletion).
   */
  includeArchived?: boolean;
}

export interface ITaskRepository {
  findAll(projectId?: ProjectId, opts?: TaskListOptions): Promise<Task[]>;
  findByProjectIds(ids: ProjectId[], opts?: TaskListOptions): Promise<Task[]>;
  findById(id: TaskId): Promise<Task | null>;
  /** Direct child tasks of an Epic (parent_task_id = parentId), oldest first. */
  findChildren(parentId: TaskId): Promise<Task[]>;
  /**
   * Highest existing task-key sequence number in a project (0 if none). Keys are
   * `${projectKey}-${NNN}`; the next key is this + 1. Used instead of a row count
   * for key allocation: counts skip the gaps left by deletes/moves and would
   * collide on the globally-unique `tasks.key`.
   */
  maxKeySeqByProject(projectId: ProjectId): Promise<number>;
  save(task: Task): Promise<Task>;
  update(task: Task): Promise<Task>;
  delete(id: TaskId): Promise<void>;
  /**
   * Atomically select the next `ready` task in one of the provided projects,
   * mark it as in_progress, and return it. Operates inside a transaction so
   * concurrent callers will skip locked rows.
   */
  dequeueNextReady(projectIds: ProjectId[]): Promise<Task | null>;
}
