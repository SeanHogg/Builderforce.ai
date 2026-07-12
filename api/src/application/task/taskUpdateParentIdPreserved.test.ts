import { describe, expect, it } from 'vitest';
import { TaskService } from './TaskService';
import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Task } from '../../domain/task/Task';
import { Project } from '../../domain/project/Project';
import {
  ProjectId,
  TaskId,
  TenantId,
  TaskStatus,
  TaskPriority,
  asTaskId,
  asProjectId,
  asTenantId,
} from '../../domain/shared/types';

// ---------------------------------------------------------------------------
// In-memory fakes (no DB) — exercise the full update → repo path.
// ---------------------------------------------------------------------------

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
      this.store.set(id, Task.reconstitute({ ...plain, key: `${newProjectKey}-${suffix}` }));
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

class InMemoryProjectRepo implements IProjectRepository {
  constructor(private readonly project: Project) {}

  async findByTenant(): Promise<Project[]> {
    return [this.project];
  }

  async findById(): Promise<Project | null> {
    return this.project;
  }

  async findByPublicId(): Promise<Project | null> {
    return this.project;
  }

  async findByKey(): Promise<Project | null> {
    return this.project;
  }

  async save(_p: Project): Promise<Project> {
    return _p;
  }

  async update(_p: Project): Promise<Project> {
    return _p;
  }

  async delete(): Promise<void> {}
}

const TENANT = asTenantId(1);
const PROJECT_ID = asProjectId(7);

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
    status: 'active',
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

function makeService() {
  const repo = new InMemoryTaskRepo();
  const projects = new InMemoryProjectRepo(makeProject());
  const service = new TaskService(repo, projects);
  return { repo, service };
}

describe('Task.update() partial-update semantics (AC-1..AC-5)', () => {
  // Helper: ensure the test environment uses the in-memory repo that respects partial updates.
  it('AC-1: tasks.update with only assignedAgentRef leaves parentTaskId unchanged', async () => {
    const { service } = makeService();
    const epic = await service.createTask(
      { projectId: PROJECT_ID as number, title: 'Epic' },
      TENANT as number,
    );
    const originalParent = epic.id;
    const child = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Child',
        parentTaskId: epic.id as number,
        assignedAgentRef: 'ide-agent-77',
        status: TaskStatus.IN_PROGRESS,
      },
      TENANT as number,
    );

    // Update only the agent ref — parentTaskId must NOT change.
    const updated = await service.updateTask(child.id as number, {
      assignedAgentRef: 'ide-agent-88',
    });

    expect(updated.assignedAgentRef).toBe('ide-agent-88');
    // The returned task reflects the merge in Task.update.
    expect(updated.parentTaskId).toBe(originalParent);

    // Persisted round-trip must agree (see AC-1 plus AC-6 strand).
    const persisted = await service.getTask(child.id as number);
    expect(persisted?.parentTaskId).toBe(originalParent);
  });

  it('AC-2: tasks.update with assignedAgentRef + explicit parentTaskId:null sets null', async () => {
    const { service } = makeService();
    const epic = await service.createTask(
      { projectId: PROJECT_ID as number, title: 'Epic' },
      TENANT as number,
    );
    const child = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Child',
        parentTaskId: epic.id as number,
        assignedAgentRef: 'ide-agent-77',
        status: TaskStatus.IN_PROGRESS,
      },
      TENANT as number,
    );

    const originalAgent = child.assignedAgentRef;

    // Explicitly clear the parentTaskId.
    const updated = await service.updateTask(child.id as number, {
      assignedAgentRef: 'ide-agent-88',
      parentTaskId: null as any,
    });

    // Both fields set as expected.
    expect(updated.assignedAgentRef).toBe('ide-agent-88');
    expect(updated.parentTaskId).toBeNull();

    // Repo round-trip reflects both sets.
    const persisted = await service.getTask(child.id as number);
    expect(persisted?.assignedAgentRef).toBe('ide-agent-88');
    expect(persisted?.parentTaskId).toBeNull();
  });

  it('AC-3: tasks.update with only parentTaskId leaves assignedAgentRef unchanged', async () => {
    const { service } = makeService();
    const epic = await service.createTask(
      { projectId: PROJECT_ID as number, title: 'Epic' },
      TENANT as number,
    );
    const child = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Child',
        parentTaskId: epic.id as number,
        assignedAgentRef: 'ide-agent-77',
        status: TaskStatus.IN_PROGRESS,
      },
      TENANT as number,
    );

    const originalAgent = child.assignedAgentRef;
    const newParent = (epic.id + 1) as TaskId;

    // Reparent only.
    const updated = await service.updateTask(child.id as number, {
      parentTaskId: newParent,
    });

    // Agent unchanged.
    expect(updated.assignedAgentRef).toBe(originalAgent);
    // Parent updated.
    expect(updated.parentTaskId).toBe(newParent);

    // Repo round-trip.
    const persisted = await service.getTask(child.id as number);
    expect(persisted?.assignedAgentRef).toBe(originalAgent);
    expect(persisted?.parentTaskId).toBe(newParent);
  });

  it('AC-4: tasks.update with empty payload leaves task unchanged', async () => {
    const { service } = makeService();
    const epic = await service.createTask(
      { projectId: PROJECT_ID as number, title: 'Epic' },
      TENANT as number,
    );
    const child = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Child v1',
        parentTaskId: epic.id as number,
        assignedAgentRef: 'ide-agent-77',
        status: TaskStatus.BACKLOG,
        priority: TaskPriority.MEDIUM,
      },
      TENANT as number,
    );

    // Empty update.
    const updated = await service.updateTask(child.id as number, {});

    // All original fields unchanged (repo round-trip confirms).
    expect(updated.title).toBe('Child v1');
    expect(updated.assignedAgentRef).toBe('ide-agent-77');
    expect(updated.status).toBe(TaskStatus.BACKLOG);
    expect(updated.priority).toBe(TaskPriority.MEDIUM);
    expect(updated.parentTaskId).toBe(epic.id);

    const persisted = await service.getTask(child.id as number);
    expect(persisted?.title).toBe('Child v1');
    expect(persisted?.assignedAgentRef).toBe('ide-agent-77');
    expect(persisted?.status).toBe(TaskStatus.BACKLOG);
    expect(persisted?.priority).toBe(TaskPriority.MEDIUM);
  });

  it('AC-5: tasks.update with all fields explicitly provides should behave like full-update', async () => {
    const { service } = makeService();
    const epic = await service.createTask(
      { projectId: PROJECT_ID as number, title: 'Epic' },
      TENANT as number,
    );
    const child = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Child v1',
        parentTaskId: epic.id as number,
        assignedAgentRef: 'ide-agent-77',
        status: TaskStatus.BACKLOG,
        priority: TaskPriority.MEDIUM,
      },
      TENANT as number,
    );

    // Update every supported field.
    const now = new Date();
    const updated = await service.updateTask(child.id as number, {
      title: 'Child v2',
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.URGENT,
      assignedAgentRef: 'ide-agent-44',
      parentTaskId: (epic.id + 2) as TaskId,
    });

    expect(updated.title).toBe('Child v2');
    expect(updated.status).toBe(TaskStatus.IN_PROGRESS);
    expect(updated.priority).toBe(TaskPriority.URGENT);
    expect(updated.assignedAgentRef).toBe('ide-agent-44');
    expect(updated.parentTaskId).toBe((epic.id + 2) as TaskId);
  });
});

describe('Task.update() broader semantic guards', () => {
  it('AC-6: concurrent updates targeting different fields should both persist correctly (no reset)', async () => {
    const { repo, service } = makeService();
    const epic = await service.createTask({ projectId: PROJECT_ID as number, title: 'Epic' }, TENANT);
    const child = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Child',
        parentTaskId: epic.id as number,
        assignedAgentRef: 'ide-agent-77',
        status: TaskStatus.IN_PROGRESS,
      },
      TENANT,
    );
    const originalParent = child.parentTaskId as number;
    const originalAgent = child.assignedAgentRef;

    // Two concurrent partial updates via different paths.
    const [updated1, updated2] = await Promise.all([
      service.updateTask(child.id as number, { assignedAgentRef: 'ide-agent-88' }),
      service.updateTask(child.id as number, { parentTaskId: (epic.id + 3) as number }),
    ]);

    expect(updated1.assignedAgentRef).toBe('ide-agent-88');
    expect(updated2.parentTaskId).toBe((epic.id + 3) as TaskId);
    const persisted = await repo.findById(child.id as TaskId);
    expect(persisted?.assignedAgentRef).toBe('ide-agent-88');
    expect(persisted?.parentTaskId).toBe((epic.id + 3) as TaskId);
  });
});