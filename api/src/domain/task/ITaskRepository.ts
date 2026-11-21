import type { TaskListScope } from '@builderforce/agent-loop';
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

/** Which tickets a list returns — agent-loop's ONE scope type, not a copy. */
export type TaskFilterScope = TaskListScope;

/**
 * The ONE ticket filter contract (parsed by `application/task/taskListFilter.ts`, applied
 * in SQL by the task repository). Every field but `scope` is optional and narrows.
 */
export interface TaskListFilter {
  scope: TaskFilterScope;
  projectId?: number;
  status?: string;
  /** Children of this parent only. */
  parentTaskId?: number;
  /** Top-level tickets only (no parent). Never set together with `parentTaskId`. */
  topLevelOnly?: boolean;
  /** Case-insensitive starts-with on the title. */
  titlePrefix?: string;
  /** Case-insensitive substring of the title. */
  titleMatch?: string;
  createdBefore?: Date;
  createdAfter?: Date;
  assigned?: 'none' | 'any';
  /** true = only persona fan-out copies (a `ticket_participants.child_task_id` points at
   *  the ticket); false = only tickets that are NOT fan-out copies. */
  isFanoutCopy?: boolean;
  taskType?: string;
}

/** Constraints a SERVICE adds on top of a caller's filter — never caller input. */
export interface TaskQueryState {
  /** Pin the archived flag (a bulk archive reads only the rows its write would change). */
  archived?: boolean;
  /** Ticket types the caller may not see (e.g. `security` without clearance). */
  excludeTaskTypes?: readonly string[];
}

export interface ITaskRepository {
  /**
   * Archive (or restore) many of the tenant's tickets in ONE statement. Ids outside the
   * tenant, or unknown, are not updated; the rows that were come back with their project.
   */
  setArchived(tenantId: number, ids: readonly number[], archived: boolean): Promise<Array<{ id: number; projectId: number }>>;
  findAll(projectId?: ProjectId, opts?: TaskListOptions): Promise<Task[]>;
  findByProjectIds(ids: ProjectId[], opts?: TaskListOptions): Promise<Task[]>;
  findById(id: TaskId): Promise<Task | null>;
  /** Many tasks in ONE query (order unspecified; unknown ids are simply absent). NOT tenant-scoped: ids are looked up as given, so a caller
   *  holding a tenant must check each task's `tenantId` against it. */
  findByIdsAcrossTenants(ids: TaskId[]): Promise<Task[]>;
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
  /**
   * Persist the aggregate. `isolation.segmentId` re-points the task's DATA-ISOLATION
   * segment in the SAME statement.
   *
   * `tasks.segment_id` is set by an INSERT trigger (migration 0056) and is NOT part of
   * the Task aggregate — it is an isolation column, not a domain field. Moving a task
   * between projects therefore left it stamped with the SOURCE project's segment, so on
   * a segmented tenant the moved ticket stayed visible to the wrong segment and invisible
   * to the right one: silent isolation drift with no error anywhere. A move passes the
   * target project's segment here; a null/omitted `segmentId` leaves the column as it is
   * (a single-segment tenant has nothing to re-point).
   */
  update(task: Task, isolation?: { segmentId: string | null }): Promise<Task>;
  delete(id: TaskId): Promise<void>;
  /**
   * Atomically select the next `ready` task in one of the provided projects,
   * mark it as in_progress, and return it. Operates inside a transaction so
   * concurrent callers will skip locked rows.
   */
  dequeueNextReady(projectIds: ProjectId[]): Promise<Task | null>;
}
