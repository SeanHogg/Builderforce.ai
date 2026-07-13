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

export interface UnassignedHighPriorityTaskOptions {
  /**
   * Optional project filter.
   */
  projectId?: number;
}

export interface UnassignedHighPriorityTaskResult {
  tasks: Array<Record<string, unknown>>;
  total: number;
  cacheInfo: {
    validForSeconds: number;
  };
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
  /**
   * Re-key every task in a project onto a new project-key prefix, preserving each
   * task's numeric sequence suffix (`<oldKey>-071` → `<newProjectKey>-071`). Run
   * when the Project Key changes so existing tasks adopt it alongside new ones.
   * Only rows whose suffix is purely numeric are touched (mirrors
   * {@link maxKeySeqByProject}); legacy/odd keys are left untouched. The new
   * prefix is globally unique, so re-keyed rows never collide. Returns the count
   * of rows re-keyed.
   */
  rekeyProject(projectId: ProjectId, newProjectKey: string): Promise<number>;
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
