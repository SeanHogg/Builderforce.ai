import { Task } from './Task';
import { TaskId, ProjectId } from '../shared/types';

export interface ITaskRepository {
  findAll(projectId?: ProjectId): Promise<Task[]>;
  findByProjectIds(ids: ProjectId[]): Promise<Task[]>;
  findById(id: TaskId): Promise<Task | null>;
  countByProject(projectId: ProjectId): Promise<number>;
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
