import { describe, expect, it } from 'vitest';
import { TaskService } from './TaskService';
import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Task } from '../../domain/task/Task';
import { Project } from '../../domain/project/Project';
import {
  ProjectId,
  TaskId,
  TaskStatus,
  ProjectStatus,
  asTaskId,
  asProjectId,
  asTenantId,
} from '../../domain/shared/types';

// ---------------------------------------------------------------------------
// In-memory fakes (no DB) — exercise repository & domain paths. ---------------------------------------------------------------------------

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

  async findAll(): Promise<Task[]> { return [...this.store.values()]; }
  async findByProjectIds(): Promise<Task[]> { return [...this.store.values()]; }
  async findById(id: TaskId): Promise<Task | null> { return this.store.get(id as number) ?? null; }
  async findChildren(parentId: TaskId): Promise<Task[]> {
    return [...this.store.values()].filter(t => (t.parentTaskId as number | null) === (parentId as number));
  }
  async maxKeySeqByProject(projectId: ProjectId): Promise<number> {
    const seqs = [...this.store.values()]
      .filter(t => (t.projectId as number) === (projectId as number))
      .map(t => Number(t.toPlain().key.split('-').pop()))
      .filter(n => Number.isFinite(n));
    return seqs.length ? Math.max(...seqs) : 0;
  }
  async rekeyProject(projectId: ProjectId, newProjectKey: string): Promise<number> {
    let n = 0;
    for (const [id, t] of this.store) {
      if ((t.projectId as number) !== (projectId as number)) continue;
      const plain = t.toPlain();
      const suffix = plain.key.split('-').pop() ?? '';
      if (!/^[0-9]+$/.test(suffix)) continue;
      this.store.set(id, Task.reconstitute({ ...plain, key: `${newProjectKey}-${suffix}` }));
      n++;
    }
    return n;
  }
  async save(task: Task): Promise<Task> { return this.put(task); }
  async update(task: Task): Promise<Task> { return this.put(task); }
  async delete(id: TaskId): Promise<void> { this.store.delete(id as number); }
  async dequeueNextReady(): Promise<Task | null> { return null; }
}

class InMemoryProjectRepo implements IProjectRepository {
  constructor(private readonly project: Project) {}
  async findByTenant(): Promise<Project[]> { return [this.project]; }
  async findById(): Promise<Project | null> { return this.project; }
  async findByPublicId(): Promise<Project | null> { return this.project; }
  async findByKey(): Promise<Project | null> { return this.project; }
  async save(p: Project): Promise<Project> { return p; }
  async update(p: Project): Promise<Project> { return p; }
  async delete(): Promise<void> {}
}

const TENANT = asTenantId(1);
const PROJECT_ID = asProjectId(7);
const TASK_ID_NONNULL = asTaskId(42);

function makeProject(): Project {
  return Project.reconstitute({
    id: PROJECT_ID,
    publicId: 'pub-7',
    tenantId: TENANT,
    key: 'ACME',
    name: 'Acme',
    description: null,
    template: null,
    rootWorkingDirectory: null,
    status: ProjectStatus.ACTIVE,
    sourceControlIntegrationId: null,
    sourceControlProvider: null,
    sourceControlRepoFullName: null,
    sourceControlRepoUrl: null,
    githubRepoUrl: null,
    githubRepoOwner: null,
    githubRepoName: null,
    governance: null,
    modality: null,
    origin: null,
    initiativeId: null,
    dueDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function makeService(): {
  repo: InMemoryTaskRepo;
  service: TaskService;
} {
  const repo = new InMemoryTaskRepo();
  const projects = new InMemoryProjectRepo(makeProject());
  const service = new TaskService(repo, projects);
  return { repo, service };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('partial-update merge/patch semantics (task.update)', () => {
  it('AC-1: assigns an agent without dropping parentTaskId', async () => {
    const { service, repo } = makeService();
    const original = await service.createTask({
      projectId: PROJECT_ID as number,
      title: 'Root',
      parentTaskId: TASK_ID_NONNULL,
    }, TENANT as number);

    // Verify initial state
    expect(original.parentTaskId).toBe(TASK_ID_NONNULL);
    expect(original.assignedAgentRef).toBeNull();

    // Update only assignee; parentTaskId should remain unchanged
    const updated = await service.updateTask(original.id as number, {
      assignedAgentRef: 'agent-111',
    });

    // Post-update state
    expect(updated.id).toBe(original.id);
    expect(updated.assignedAgentRef).toBe('agent-111');
    expect(updated.parentTaskId).toBe(TASK_ID_NONNULL); // parent remains attached

    // Persisted record should match
    const persisted = await repo.findById(updated.id);
    expect(persisted?.parentTaskId).toBe(TASK_ID_NONNULL);
  });

  it('AC-2: clears parentTaskId when explicitly null', async () => {
    const { service, repo } = makeService();
    const created = await service.createTask({
      projectId: PROJECT_ID as number,
      title: 'Independent',
      parentTaskId: TASK_ID_NONNULL,
    }, TENANT as number);

    expect(created.parentTaskId).toBe(TASK_ID_NONNULL);

    const updated = await service.updateTask(created.id as number, {
      parentTaskId: null, // explicit null to detach
    });

    expect(updated.parentTaskId).toBeNull();
    expect(updated.assignedAgentRef).toBeNull();

    const persisted = await repo.findById(updated.id);
    expect(persisted?.parentTaskId).toBeNull();
  });

  it('AC-3: clears parentTaskId via explicit null', async () => {
    const { service, repo } = makeService();
    const original = await service.createTask({
      projectId: PROJECT_ID as number,
      title: 'Child',
      parentTaskId: TASK_ID_NONNULL,
    }, TENANT as number);

    expect(original.parentTaskId).toBe(TASK_ID_NONNULL);

    // Explicit null should detach
    const updated = await service.updateTask(original.id as number, {
      parentTaskId: null,
    });

    expect(updated.parentTaskId).toBeNull();

    const persisted = await repo.findById(updated.id);
    expect(persisted?.parentTaskId).toBeNull();
  });

  it('AC-4: reparent via explicit value', async () => {
    const { service, repo } = makeService();
    const parent1 = await service.createTask({
      projectId: PROJECT_ID as number,
      title: 'Parent-1',
    }, TENANT as number);

    const child1 = await service.createTask({
      projectId: PROJECT_ID as number,
      title: 'Child',
      parentTaskId: parent1.id,
    }, TENANT as number);

    const parent2 = await service.createTask({
      projectId: PROJECT_ID as number,
      title: 'Parent-2',
    }, TENANT as number);

    expect(child1.parentTaskId).toBe(parent1.id);

    // Move child under parent2
    const updated = await service.updateTask(child1.id as number, {
      parentTaskId: parent2.id,
    });

    expect(updated.parentTaskId).toBe(parent2.id);

    const persisted = await repo.findById(updated.id);
    expect(persisted?.parentTaskId).toBe(parent2.id);
  });

  it('AC-5: status update retains existing assignedAgentRef', async () => {
    const { service, repo } = makeService();
    const original = await service.createTask({
      projectId: PROJECT_ID as number,
      title: 'Worker',
      status: TaskStatus.BACKLOG,
      assignedAgentRef: 'agent-123',
    }, TENANT as number);

    expect(original.assignedAgentRef).toBe('agent-123');

    // Only change status; agent assignment must persist
    const updated = await service.updateTask(original.id as number, {
      status: TaskStatus.IN_PROGRESS,
    });

    expect(updated.assignedAgentRef).toBe('agent-123');

    const persisted = await repo.findById(updated.id);
    expect(persisted?.assignedAgentRef).toBe('agent-123');
  });
});