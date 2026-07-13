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
// In-memory fakes (no DB) — exercise repository & domain paths.
// ---------------------------------------------------------------------------

class InMemoryTaskRepo implements ITaskRepository {
  private seq = 1;
  readonly store = new Map<number, Task>();

  private put(task: Task): Task {
    const plain = task.toPlain();
    const newId =
      plain.id === 0 ? this.seq++ : (plain.id as number);
    const stored = Task.reconstitute({ ...plain, id: asTaskId(newId) });
    this.store.set(newId, stored);
    return stored;
  }

  async findAll(projectId?: ProjectId, opts?: { includeArchived?: boolean }): Promise<Task[]> {
    return [...this.store.values()];
  }
  async findByProjectIds(
    ids: ProjectId[],
    opts?: { includeArchived?: boolean },
  ): Promise<Task[]> {
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
    return 0;
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
  async dequeueNextReady(projectIds: ProjectId[]): Promise<Task | null> {
    return null;
  }
}

class InMemoryProjectRepo implements IProjectRepository {
  constructor(private readonly project: Project) {}
  async findByTenant(): Promise<Project[]> {
    return [this.project];
  }
  async findById(projectId: ProjectId): Promise<Project | null> {
    return this.project;
  }
  async findByPublicId(): Promise<Project | null> {
    return this.project;
  }
  async findByKey(): Promise<Project | null> {
    return this.project;
  }
  async save(p: Project): Promise<Project> {
    return p;
  }
  async update(p: Project): Promise<Project> {
    return p;
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

describe('taskUpdateParentIdPreserved (FR-4: preserve parentTaskId on agent-only update)', () => {
  it('FR-4: assignedAgentRef-only update on a parented task preserves parentTaskId', async () => {
    const { service, repo } = makeService();
    const parent = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Parent',
        taskType: 'epic',
      },
      TENANT as number,
    );

    const child = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Child under Epic',
        parentTaskId: parent.id as number,
      },
      TENANT as number,
    );

    expect(child.parentTaskId).toEqual(parent.id);

    const updated = await service.updateTask(child.id as number, {
      assignedAgentRef: 'agent-worker-1',
    });

    expect(updated.parentTaskId).toEqual(parent.id);
    expect(updated.assignedAgentRef).toEqual('agent-worker-1');

    const persisted = await repo.findById(updated.id as number);
    expect(persisted?.parentTaskId).toEqual(parent.id);
  });
});