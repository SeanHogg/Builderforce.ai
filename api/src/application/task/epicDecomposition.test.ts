import { describe, expect, it } from 'vitest';
import { TaskService } from './TaskService';
import { EpicDecomposer, heuristicEpicDecomposer } from './EpicDecomposer';
import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Task } from '../../domain/task/Task';
import { Project } from '../../domain/project/Project';
import {
  ProjectId, TaskId, TenantId, TaskType, ProjectStatus,
  asTaskId, asProjectId, asTenantId,
} from '../../domain/shared/types';

// ---------------------------------------------------------------------------
// In-memory fakes (no DB) — exercise the full reclassify → fan-out data path.
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

  async findAll(): Promise<Task[]> { return [...this.store.values()]; }
  async findByProjectIds(): Promise<Task[]> { return [...this.store.values()]; }
  async findById(id: TaskId): Promise<Task | null> { return this.store.get(id as number) ?? null; }
  async findChildren(parentId: TaskId): Promise<Task[]> {
    return [...this.store.values()].filter(t => (t.parentTaskId as number | null) === (parentId as number));
  }
  async countByProject(projectId: ProjectId): Promise<number> {
    return [...this.store.values()].filter(t => (t.projectId as number) === (projectId as number)).length;
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
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function makeService(decomposer?: EpicDecomposer) {
  const repo = new InMemoryTaskRepo();
  const projects = new InMemoryProjectRepo(makeProject());
  const service = new TaskService(repo, projects, decomposer);
  return { repo, service };
}

describe('heuristicEpicDecomposer', () => {
  it('flags a checklist description as an Epic and parses each item', async () => {
    const task = Task.create({
      projectId: PROJECT_ID,
      title: 'Build onboarding',
      description: '- [ ] Design schema\n- [ ] API routes\n- [ ] Frontend form',
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: null,
      assignedAgentHostId: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'ACME',
      projectTaskCount: 0,
    });
    const plan = await heuristicEpicDecomposer.assess(task);
    expect(plan.isEpic).toBe(true);
    expect(plan.children.map(c => c.title)).toEqual(['Design schema', 'API routes', 'Frontend form']);
  });

  it('does NOT flag a single-line task with no checklist', async () => {
    const task = Task.create({
      projectId: PROJECT_ID,
      title: 'Fix typo',
      description: 'Just fix the typo on the login page.',
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: null,
      assignedAgentHostId: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'ACME',
      projectTaskCount: 0,
    });
    const plan = await heuristicEpicDecomposer.assess(task);
    expect(plan.isEpic).toBe(false);
    expect(plan.children).toHaveLength(0);
  });
});

describe('Task.reclassifyAsEpic', () => {
  it('flips type to epic and sheds the agent assignee', () => {
    const t = Task.create({
      projectId: PROJECT_ID,
      title: 'Epic candidate',
      description: null,
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: null,
      assignedAgentHostId: null,
      assignedAgentRef: 'ide-agent-9',
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'ACME',
      projectTaskCount: 0,
    });
    expect(t.isAssignedToAgent).toBe(true);
    const epic = t.reclassifyAsEpic();
    expect(epic.taskType).toBe(TaskType.EPIC);
    expect(epic.isEpic).toBe(true);
    expect(epic.assignedAgentRef).toBeNull();
    expect(epic.isAssignedToAgent).toBe(false);
  });
});

describe('TaskService on-assign decomposition', () => {
  it('decomposes an agent-assigned checklist task into an Epic + child tasks on create', async () => {
    const { repo, service } = makeService();
    const created = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Build onboarding',
        description: '- [ ] Design schema\n- [ ] API routes\n- [ ] Frontend form',
        assignedAgentRef: 'ide-agent-9',
      },
      TENANT as number,
    );

    // The returned task is now the Epic (reclassified, assignee shed).
    expect(created.taskType).toBe(TaskType.EPIC);
    expect(created.assignedAgentRef).toBeNull();

    const children = await repo.findChildren(created.id);
    expect(children).toHaveLength(3);
    expect(children.map(c => c.title)).toEqual(['Design schema', 'API routes', 'Frontend form']);
    // Children link back to the Epic and are plain tasks.
    for (const child of children) {
      expect(child.parentTaskId).toBe(created.id);
      expect(child.taskType).toBe(TaskType.TASK);
    }
    // Children get sequential keys distinct from the Epic's.
    const keys = new Set([created.key, ...children.map(c => c.key)]);
    expect(keys.size).toBe(4);
  });

  it('does NOT decompose a human-assigned task even with a checklist', async () => {
    const { repo, service } = makeService();
    const created = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Build onboarding',
        description: '- [ ] Design schema\n- [ ] API routes',
        assignedUserId: 'user-123',
      },
      TENANT as number,
    );
    expect(created.taskType).toBe(TaskType.TASK);
    expect(await repo.findChildren(created.id)).toHaveLength(0);
  });

  it('does NOT decompose an agent task the agent can execute directly (no checklist)', async () => {
    const { repo, service } = makeService();
    const created = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Fix typo',
        description: 'one-liner, no list',
        assignedAgentRef: 'ide-agent-9',
      },
      TENANT as number,
    );
    expect(created.taskType).toBe(TaskType.TASK);
    expect(created.assignedAgentRef).toBe('ide-agent-9');
    expect(await repo.findChildren(created.id)).toHaveLength(0);
  });

  it('fires the on-assign hook when a plain task is reassigned to an agent via update', async () => {
    const { repo, service } = makeService();
    const created = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Build onboarding',
        description: '- [ ] Design schema\n- [ ] API routes',
      },
      TENANT as number,
    );
    expect(created.taskType).toBe(TaskType.TASK);

    const updated = await service.updateTask(created.id as number, { assignedAgentRef: 'ide-agent-9' });
    expect(updated.taskType).toBe(TaskType.EPIC);
    expect(await repo.findChildren(updated.id)).toHaveLength(2);
  });

  it('honors a custom (LLM-stub) decomposer with explicit fan-out assignees', async () => {
    const custom: EpicDecomposer = {
      async assess() {
        return {
          isEpic: true,
          children: [
            { title: 'Backend', assignedAgentRef: 'agent-be' },
            { title: 'Frontend', assignedUserId: 'user-fe' },
          ],
        };
      },
    };
    const { repo, service } = makeService(custom);
    const epic = await service.createTask(
      { projectId: PROJECT_ID as number, title: 'Anything', assignedAgentRef: 'planner' },
      TENANT as number,
    );
    const children = await repo.findChildren(epic.id);
    expect(children).toHaveLength(2);
    expect(children.find(c => c.title === 'Backend')!.assignedAgentRef).toBe('agent-be');
    expect(children.find(c => c.title === 'Frontend')!.assignedUserId).toBe('user-fe');
  });
});

describe('TaskService.getEpicTree', () => {
  it('returns the Epic and its direct children', async () => {
    const { service } = makeService();
    const epic = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Build onboarding',
        description: '- [ ] A\n- [ ] B',
        assignedAgentRef: 'ide-agent-9',
      },
      TENANT as number,
    );
    const tree = await service.getEpicTree(epic.id as number);
    expect(tree.epic.id).toBe(epic.id);
    expect(tree.children.map(c => c.title)).toEqual(['A', 'B']);
  });
});
