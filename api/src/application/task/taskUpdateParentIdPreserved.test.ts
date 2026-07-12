import { describe, expect, it } from 'vitest';
import { Task } from '../../domain/task/Task';
import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { TaskService } from './TaskService';
import { Project } from '../../domain/project/Project';
import {
  ProjectId,
  TaskId,
  asProjectId,
  asTaskId,
  TaskPriority,
  TaskStatus,
  ProjectStatus,
} from '../../domain/shared/types';

// ---------------------------------------------------------------------------
// In-memory fakes (no DB) — test the DTO→Task→persist path without a real DB.
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
    return [...this.store.values()].filter(
      t => (t.parentTaskId as number | null) === (parentId as number),
    );
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
      this.store.set(
        id,
        Task.reconstitute({ ...plain, key: `${newProjectKey}-${suffix}` }),
      );
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
  async save(p: Project): Promise<Project> {
    return p;
  }
  async update(p: Project): Promise<Project> {
    return p;
  }
  async delete(): Promise<void> {}
}

const TENANT = 1;
const PROJECT_ID = 7;

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

function makeService() {
  const repo = new InMemoryTaskRepo();
  const projects = new InMemoryProjectRepo(makeProject());
  const service = new TaskService(repo, projects);
  return { repo, service };
}

describe('Task.update() parentTaskId preservation (AC-1..AC-4)', () => {
  describe('AC-1: update only assignedAgentRef on task with parentTaskId', () => {
    it('should preserve existing parentTaskId when only assignedAgentRef changes', async () => {
      const { repo, service } = makeService();
      const epic = await service.createTask(
        {
          projectId: PROJECT_ID as number,
          title: 'Epic',
        },
        TENANT,
      );
      // The service creation passes default values: no checklist, single-line description
      const child = await service.createTask(
        {
          projectId: PROJECT_ID as number,
          title: 'Child',
          parentTaskId: epic.id as number,
        },
        TENANT,
      );
      expect(child.parentTaskId).toBe(epic.id);

      const updated = await service.updateTask(
        child.id as number,
        { assignedAgentRef: 'ide-agent-42' },
      );

      // After update, child should still be a child of the Epic (parentTaskId unchanged)
      expect(updated.parentTaskId).toBe(epic.id);
      expect(updated.assignedAgentRef).toBe('ide-agent-42');
    });
  });

  describe('AC-2: update with assignedAgentRef + parentTaskId: null', () => {
    it('should set parentTaskId to null and assignedAgentRef in the same payload', async () => {
      const { repo, service } = makeService();
      const epic = await service.createTask(
        {
          projectId: PROJECT_ID as number,
          title: 'Epic',
        },
        TENANT,
      );
      const child = await service.createTask(
        {
          projectId: PROJECT_ID as number,
          title: 'Child',
          parentTaskId: epic.id as number,
        },
        TENANT,
      );
      expect(child.parentTaskId).toBe(epic.id);

      const detached = await service.updateTask(
        child.id as number,
        { assignedAgentRef: 'ide-agent-99', parentTaskId: null },
      );

      expect(detached.parentTaskId).toBeNull();
      expect(detached.assignedAgentRef).toBe('ide-agent-99');
      expect((await repo.findById(epic.id as TaskId))?.parentTaskId).toBeNull();
    });
  });

  describe('AC-3: update only parentTaskId on task with existing assignedAgentRef', () => {
    it('should leave assignedAgentRef unchanged when only parentTaskId changes', async () => {
      const { repo, service } = makeService();
      const epic = await service.createTask(
        {
          projectId: PROJECT_ID as number,
          title: 'Epic',
        },
        TENANT,
      );
      const child = await service.createTask(
        {
          projectId: PROJECT_ID as number,
          title: 'Child',
          parentTaskId: epic.id as number,
          assignedAgentRef: 'ide-agent-55',
        },
        TENANT,
      );
      const oldAgent = child.assignedAgentRef;

      const reparented = await service.updateTask(
        child.id as number,
        { parentTaskId: (epic.id + 1) as number },
      );

      expect(reparented.assignedAgentRef).toBe(oldAgent);
      expect(reparented.parentTaskId).toBe((epic.id + 1) as TaskId);
    });
  });

  describe('AC-4: update with empty payload', () => {
    it('should leave the task unchanged when no fields are provided', async () => {
      const { repo, service } = makeService();
      const epic = await service.createTask(
        {
          projectId: PROJECT_ID as number,
          title: 'Epic',
        },
        TENANT,
      );
      const child = await service.createTask(
        {
          projectId: PROJECT_ID as number,
          title: 'Child',
          parentTaskId: epic.id as number,
          assignedAgentRef: 'ide-agent-77',
        },
        TENANT,
      );
      const oldParent = child.parentTaskId;
      const oldAgent = child.assignedAgentRef;

      const emptyUpdate = await service.updateTask(child.id as number, {});

      expect(emptyUpdate.parentTaskId).toBe(oldParent);
      expect(emptyUpdate.assignedAgentRef).toBe(oldAgent);
    });
  });
});

describe('Task.update() partial-update semantic guards (AC-5)', () => {
  it('should apply full update when all fields are provided', async () => {
    const { repo, service } = makeService();
    const epic = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Epic',
      },
      TENANT,
    );
    const child = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Child',
        parentTaskId: epic.id as number,
        assignedAgentRef: 'ide-agent-33',
        status: TaskStatus.BACKLOG,
        priority: TaskPriority.HIGH,
      },
      TENANT,
    );

    const allFields = {
      title: 'Child v2',
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.URGENT,
      assignedAgentRef: 'ide-agent-44',
      parentTaskId: (epic.id + 2) as number,
    } as any;

    const updated = await service.updateTask(child.id as number, allFields);

    expect(updated.title).toBe('Child v2');
    expect(updated.status).toBe(TaskStatus.IN_PROGRESS);
    expect(updated.priority).toBe(TaskPriority.URGENT);
    expect(updated.assignedAgentRef).toBe('ide-agent-44');
    expect(updated.parentTaskId).toBe((epic.id + 2) as TaskId);
  });
});