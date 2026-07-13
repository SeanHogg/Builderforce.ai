/**
 * In-memory implementation of ITaskRepository for development.
 * Defined in: api/src/persistence/inMemoryTaskRepository.ts
 */

import type { ITaskRepository, SearchParams } from './TaskRepository';

/**
 * Minimal in-memory task repository.
 * Used for development and testing; production implementations should use a real data store.
 */
export class InMemoryTaskRepository implements ITaskRepository {
  private tasks = new Map<string, unknown>();

  async getById(id: string): Promise<ITaskRepository['getById']['returnType']> {
    const task = this.tasks.get(id) as ITaskRepository['getById']['returnType'];
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }
    return task;
  }

  async save(task: ITaskRepository['save']['paramType']): Promise<ITaskRepository['save']['returnType']> {
    const newTask = { ...task, updatedAt: task.updatedAt, createdAt: task.createdAt, id: task.id, status: task.status } as Parameters<ITaskRepository['save']>[0];
    this.tasks.set(newTask.id, newTask);
    return newTask;
  }

  async update(task: ITaskRepository['update']['paramType']): Promise<ITaskRepository['update']['returnType']> {
    const updated = { ...task, updatedAt: task.updatedAt, id: task.id, status: task.status } as Parameters<ITaskRepository['update']>[0];
    this.tasks.set(updated.id, updated);
    return updated;
  }

  async search(params: SearchParams): Promise<ITaskRepository['search']['returnType']> {
    let result = Array.from(this.tasks.values()).filter((t) => {
      if (params.status && t.status && !params.status.includes(t.status as never)) return false;
      if (params.titleContains && t.title && !t.title.toLowerCase().includes(params.titleContains.toLowerCase())) return false;
      if (params.parentTaskId && t.parentTaskId !== params.parentTaskId) return false;
      return true;
    });

    if (params.offset) result = result.slice(params.offset);
    if (params.limit) result = result.slice(0, params.limit);
    return result;
  }

  async delete(id: string): Promise<void> {
    const existed = this.tasks.has(id);
    if (!existed) {
      throw new Error(`Task ${id} not found for deletion`);
    }
    this.tasks.delete(id);
  }
}