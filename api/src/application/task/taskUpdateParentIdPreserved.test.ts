import { describe, expect, it } from 'vitest';
import { TaskService } from './TaskService';
import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Task } from '../../domain/task/Task';
import { EpicDecomposer } from './EpicDecomposer';
import {
  ProjectId,
  TaskId,
  TenantId,
  TaskType,
  TaskPriority,
  TaskStatus,
  asProjectId,
  asTaskId,
  asTenantId,
} from '../../domain/shared/types';

// -------------------------------------------------------------------
// In-memory task repository designed for update-preservation tests.
// -------------------------------------------------------------------
class InMemoryTaskRepo implements ITaskRepository {
  private seq = 1;
  readonly store = new Map<number, Task>();

  private put(task: Task): Task {
    const plain = task.toPlain();
    const id = plain.id === 0 ? this.seq++ : (plain.id as number);
    const stored = Task.reconstitute({ ...plain, id: asTaskId(id) });
    this.store.set(id, stored);
    return stored;
  }

  async findAll(): Promise<Task[]> {
    return [...this.store.values()];
  }
  async findByProjectIds(): Promise<Task[]> {
    return [...this.store.values()];
  }
  async findById(id: TaskId): Promise<Task | null> {
    return this.store.get(id as number) ?? null;
  }
  async findChildren(parentId: TaskId): Promise<Task[]> {
    return [...this.store.values()].filter((t) => (t.parentTaskId as number | null) === (parentId as number));
  }
  async maxKeySeqByProject(projectId: ProjectId): Promise<number> {
    const seqs = [...this.store.values()]
      .filter((t) => (t.projectId as number) === (projectId as number))
      .map((t) => Number(t.toPlain().key.split('-').pop()))
      .filter((n) => Number.isFinite(n));
    return seqs.length ? Math.max(...seqs) : 0;
  }
  async rekeyProject(projectId: ProjectId, newProjectKey: string): Promise<number> {
    let n = 0;
    for (const [id, t] of this.store) {
      if ((t.projectId as number) !== (projectId as number)) continue;
      const plain = t.toPlain();
      const suffix = plain.key.split('-').pop() ?? '';
      if (!/^[0-9]+$/.test(suffix)) continue;
      this.store.set(id, Task.reconstitute({ ...plain, key: `${newProjectKey}-${suffix}` } as never));
      n++;
    }
    return n;
  }
  async save(task: Task): Promise<Task> {
    return this.put(task);
  }
  async update(task: Task): Promise<Task> {
    return this.put(task);
  }
  async delete(id: TaskId): Promise<void> {
    this.store.delete(id as number);
  }
  async dequeueNextReady(): Promise<Task | null> {
    return null;
  }
}

// -------------------------------------------------------------------
// Minimal IProjectRepository that does nothing (never called in tests).
// -------------------------------------------------------------------
class NullProjectRepo implements IProjectRepository {
  async findByTenant(): Promise<never> {
    throw new Error('should not be called in update-preservation tests');
  }
  async findById(): Promise<never> {
    throw new Error('should not be called in update-preservation tests');
  }
  async findByPublicId(): Promise<never> {
    throw new Error('should not be called in update-preservation tests');
  }
  async findByKey(): Promise<never> {
    throw new Error('should not be called in update-preservation tests');
  }
  async save(): Promise<never> {
    throw new Error('should not be called in update-preservation tests');
  }
  async update(): Promise<never> {
    throw new Error('should not be called in update-preservation tests');
  }
  async delete(): Promise<void> {}
}

const TENANT = asTenantId(1);
const PROJECT_ID = asProjectId(1);

function makeService() {
  const repo = new InMemoryTaskRepo();
  const projects = new NullProjectRepo();
  const service = new TaskService(repo, projects);
  return { repo };
}

// -------------------------------------------------------------------
// Fixture helpers for AC-1 to AC-4.
// -------------------------------------------------------------------
function makeChildProject(
  key: string,
  taskKey: string,
  parentTaskId: TaskId,
): Task {
  return Task.create({
    projectId: PROJECT_ID,
    projectKey: key,
    lastKeySeq: 0,
    title: 'Project',
    status: undefined as never,
    taskType: undefined as never,
    priority: undefined as never,
    parentTaskId,
  });
}

function makeChildTask(options: {
  key: string;
  title: string;
  parentTaskId: TaskId | null;
}): Task {
  return Task.create({
    projectId: PROJECT_ID,
    projectKey: options.key,
    lastKeySeq: 0,
    title: options.title,
    status: TaskStatus.BACKLOG,
    taskType: TaskType.TASK,
    priority: TaskPriority.MEDIUM,
    parentTaskId: options.parentTaskId,
  });
}

function makeParentEpic(key: string, taskKey: string): Task {
  return Task.create({
    projectId: PROJECT_ID,
    projectKey: key,
    lastKeySeq: 0,
    title: 'Parent Epic',
    status: TaskStatus.BACKLOG,
    taskType: TaskType.EPIC,
    priority: TaskPriority.MEDIUM,
    parentTaskId: null,
  });
}

describe('Task.update() parentTaskId preservation (AC-1, AC-2, AC-3, AC-4)', () => {
  const { repo: taskRepo } = makeService();

  it('preserves parentTaskId when parentTaskId is omitted from updatePayload (AC-1)', async () => {
    const parentId = 100;
    const taskId = asTaskId(1);

    // Parent Epic
    const parent = makeParentEpic('BF-P-001', 'BF-P-001-001');
    taskRepo.update(parent);

    // Child task
    const child = makeChildTask({ key: 'BF-001', title: 'Child Task', parentTaskId: parentId });
    const saved = taskRepo.update(child);

    // Assignment-only update (no parentTaskId)
    const taskService = new TaskService(taskRepo, new NullProjectRepo());
    await taskService.updateTask(taskId as number, { assignedAgentRef: 'agent-7' });

    const fresh = await taskService.getTask(taskId as number);
    expect(fresh.parentTaskId).toBe(saved.parentTaskId);
    expect(fresh.parentTaskId).toBe(parentId);
  });

  it('clears parentTaskId when explicitly set to null (AC-2)', async () => {
    const parentId = 101;
    const taskId = asTaskId(2);

    // Parent Epic
    const parent = makeParentEpic('BF-P-002', 'BF-P-002-001');
    taskRepo.update(parent);

    // Child task
    const child = makeChildTask({ key: 'BF-002', title: 'Child Task', parentTaskId: parentId });
    const saved = taskRepo.update(child);

    // Explicit null to clear the relationship
    const taskService = new TaskService(taskRepo, new NullProjectRepo());
    await taskService.updateTask(taskId as number, { parentTaskId: null });

    const fresh = await taskService.getTask(taskId as number);
    expect(fresh.parentTaskId).toBeNull();
    expect(fresh.parentTaskId).toBe(saved.parentTaskId);
  });

  it('updates to a new parentTaskId (AC-3)', async () => {
    const oldParentId = 102;
    const newParentId = 103;
    const taskId = asTaskId(3);

    // Old parent Epic
    const oldParent = makeParentEpic('BF-P-003', 'BF-P-003-001');
    taskRepo.update(oldParent);

    // New parent Epic
    const newParent = makeParentEpic('BF-P-004', 'BF-P-004-001');
    taskRepo.update(newParent);

    // Child task initially under old parent
    const child = makeChildTask({ key: 'BF-003', title: 'Child Task', parentTaskId: oldParentId });
    const savedBeforeMove = taskRepo.update(child);

    // Assignment-only update (no parentTaskId) — preserves existing parent
    const taskService = new TaskService(taskRepo, new NullProjectRepo());
    await taskService.updateTask(taskId as number, { assignedAgentRef: 'agent-8' });

    const freshBeforeMove = await taskService.getTask(taskId as number);
    expect(freshBeforeMove.parentTaskId).toBe(oldParentId);
    expect(freshBeforeMove.parentTaskId).toBe(savedBeforeMove.parentTaskId);

    // Now change parent explicitly
    await taskService.updateTask(taskId as number, { parentTaskId: newParentId });

    const freshAfterMove = await taskService.getTask(taskId as number);
    expect(freshAfterMove.parentTaskId).toBe(newParentId);
    expect(freshAfterMove.parentTaskId).toBe(newParentId);
  });

  it('keeps parentTaskId=null when it is null and assignment-only update is applied (AC-4)', async () => {
    const taskId = asTaskId(4);

    // Top-level task
    const topTask = makeChildTask({ key: 'BF-004', title: 'Top-level Task', parentTaskId: null });
    const saved = taskRepo.update(topTask);

    // Assignment-only update (no parentTaskId) — preserves null parent
    const taskService = new TaskService(taskRepo, new NullProjectRepo());
    await taskService.updateTask(taskId as number, { assignedAgentRef: 'agent-9' });

    const fresh = await taskService.getTask(taskId as number);
    expect(fresh.parentTaskId).toBeNull();
    expect(fresh.parentTaskId).toBe(saved.parentTaskId);
  });
});