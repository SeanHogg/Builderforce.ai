import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskService } from './TaskService';
import { EpicDecomposer, heuristicEpicDecomposer } from './EpicDecomposer';
import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Task } from '../../domain/task/Task';
import { Project } from '../../domain/project/Project';
import {
  ProjectId,
  TaskId,
  TenantId,
  TaskType,
  TaskPriority,
  AgentType,
  TaskStatus,
  ProjectStatus,
  asProjectId,
  asTaskId,
  asTenantId,
  asAgentHostId,
} from '../../domain/shared/types';

// -------------------------------------------------------------------
// In-memory fakes (no DB) — isolate the update side-effect and parentTaskId behavior.
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
    return [...this.store.values()].filter(
      (t) => (t.parentTaskId as number | null) === (parentId as number),
    );
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
      if (!/^\d+$/.test(suffix)) continue;
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

function makeService(
  decomposer?: EpicDecomposer,
  recommendChildAssignee?: (
    projectId: number,
    roleKey?: string,
  ) => Promise<{
    memberKind: 'human' | 'cloud_agent' | 'host_agent';
    memberRef: string;
  } | null>,
) {
  const repo = new InMemoryTaskRepo();
  const projects = new InMemoryProjectRepo(makeProject());
  const service = new TaskService(repo, projects, decomposer, recommendChildAssignee);
  return { repo, service };
}

// -------------------------------------------------------------------
// FR-1 — parentTaskId is preserved on assignedAgentRef update
// -------------------------------------------------------------------
describe('TaskService.updateTask parentTaskId preservation (FR-1)', () => {
  let repo: InMemoryTaskRepo;
  let service: TaskService;
  let spyDecomposer: {
    assess: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    spyDecomposer = { assess: vi.fn() };
    spyDecomposer.assess.mockResolvedValue(heuristicEpicDecomposer.assess);
    const { repo: r, service: s } = makeService(spyDecomposer as EpicDecomposer);
    repo = r;
    service = s;
  });

  it('preserves parentTaskId when only assignedAgentRef changes (transition into agent ownership)', async () => {
    // Create parent
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: null,
      status: TaskStatus.TODO as any, // workaround for Task.create
      priority: TaskPriority.MEDIUM,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    await repo.save(parent);

    // Create unassigned child linked to parent
    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
      parentTaskId: parent.id,
    });
    await repo.save(child);

    // Transition into agent ownership via updateTask — this should NOT strip parentTaskId
    const updated = await service.updateTask(child.id as number, {
      assignedAgentRef: 'ide-agent-123',
    });

    expect(updated.parentTaskId).toBe(parent.id);
    const refreshed = await repo.findById(updated.id);
    expect(refreshed?.parentTaskId).toBe(parent.id);
  });

  it('preserves parentTaskId when assignedAgentRef is changed to a different agent', async () => {
    // Create parent
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: null,
      status: TaskStatus.TODO as any,
      priority: TaskPriority.MEDIUM,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    await repo.save(parent);

    // Create child already assigned to agent A
    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: 'ide-agent-5',
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
      parentTaskId: parent.id,
    });
    await repo.save(child);

    // Reassign to different agent — parentTaskId should stay
    const updated = await service.updateTask(child.id as number, {
      assignedAgentRef: 'ide-agent-456',
    });

    expect(updated.parentTaskId).toBe(parent.id);
    const refreshed = await repo.findById(updated.id);
    expect(refreshed?.parentTaskId).toBe(parent.id);
  });
});

// -------------------------------------------------------------------
// FR-2 — Auto-run side effect fires exactly once
// -------------------------------------------------------------------
describe('TaskService.updateTask side-effect behavior (FR-2)', () => {
  let repo: InMemoryTaskRepo;
  let service: TaskService;
  let spyDecomposer: {
    assess: ReturnType<typeof vi.fn>;
  };

  const simplePlan = {
    isEpic: false,
    children: [],
  };

  beforeEach(() => {
    spyDecomposer = { assess: vi.fn() };
    spyDecomposer.assess.mockResolvedValue(simplePlan);
    const { repo: r, service: s } = makeService(spyDecomposer as EpicDecomposer);
    repo = r;
    service = s;
  });

  it('auto-run side effect fires exactly once per qualifying assignment transition', async () => {
    // Parent
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: null,
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    await repo.save(parent);

    // Unassigned child
    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
      parentTaskId: parent.id,
    });
    await repo.save(child);

    // Transition from unassigned → assigned — assess should fire exactly once
    await expect(
      service.updateTask(child.id as number, { assignedAgentRef: 'ide-agent-789' }),
    ).resolves.not.toThrow();

    expect(spyDecomposer.assess).toHaveBeenCalledTimes(1);

    // Additional no-op agent reassignments should NOT trigger the hook again for the same transition
    await expect(
      service.updateTask(child.id as number, { assignedAgentRef: 'ide-agent-789' }),
    ).resolves.not.toThrow();

    expect(spyDecomposer.assess).toHaveBeenCalledTimes(1);
  });

  it('skip auto-run hook when task is already assigned and only state fields update', async () => {
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: null,
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    await repo.save(parent);

    // Already assigned to agentA, linked to parent
    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: 'agentA',
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
      parentTaskId: parent.id,
    });
    await repo.save(child);

    // Reassign to same agent — assess should NOT fire (no transition)
    await expect(
      service.updateTask(child.id as number, { assignedAgentRef: 'agentA' }),
    ).resolves.not.toThrow();

    expect(spyDecomposer.assess).not.toHaveBeenCalled();

    // Update another field (title) should also not fire the hook
    await expect(
      service.updateTask(child.id as number, { title: 'Updated Title' }),
    ).resolves.not.toThrow();

    expect(spyDecomposer.assess).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------
// FR-3 — Test: No side effect on a no-op assignedAgentRef update
// -------------------------------------------------------------------
describe('TaskService.updateTask (FR-3)', () => {
  let repo: InMemoryTaskRepo;
  let service: TaskService;
  let spyDecomposer: {
    assess: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    spyDecomposer = { assess: vi.fn() };
    spyDecomposer.assess.mockResolvedValue({ isEpic: false, children: [] });
    const { repo: r, service: s } = makeService(spyDecomposer as EpicDecomposer);
    repo = r;
    service = s;
  });

  it('does NOT fire auto-run side effect when assignedAgentRef value is unchanged', async () => {
    // Parent
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: null,
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    await repo.save(parent);

    // Unassigned child linked to parent
    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
      parentTaskId: parent.id,
    });
    await repo.save(child);

    // Unassigned → same empty string (still unassigned) should not transition
    await expect(
      service.updateTask(child.id as number, { assignedAgentRef: '' }),
    ).resolves.not.toThrow();

    expect(spyDecomposer.assess).not.toHaveBeenCalled();

    const refreshed = await repo.findById(child.id);
    expect(refreshed?.parentTaskId).toBe(parent.id);
  });

  it('preserves parentTaskId when updating another field but not touching assignedAgentRef', async () => {
    // Parent
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: null,
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    await repo.save(parent);

    // Unassigned child linked to parent
    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
      parentTaskId: parent.id,
    });
    await repo.save(child);

    // Update metadata only; no agent reassign/deassign, no decomposition
    await expect(
      service.updateTask(child.id as number, { title: 'Updated Title' }),
    ).resolves.not.toThrow();

    expect(spyDecomposer.assess).not.toHaveBeenCalled();

    const refreshed = await repo.findById(child.id);
    expect(refreshed?.parentTaskId).toBe(parent.id);
  });
});

// -------------------------------------------------------------------
// FR-4 — parentTaskId is preserved when updating multiple fields concurrently
// -------------------------------------------------------------------
describe('TaskService.updateTask (FR-4)', () => {
  let repo: InMemoryTaskRepo;
  let service: TaskService;
  let spyDecomposer: {
    assess: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    spyDecomposer = { assess: vi.fn() };
    spyDecomposer.assess.mockResolvedValue({ isEpic: false, children: [] });
    const { repo: r, service: s } = makeService(spyDecomposer as EpicDecomposer);
    repo = r;
    service = s;
  });

  it('preserves parentTaskId across multiple changes update that includes assignment transition', async () => {
    // Parent
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: null,
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    await repo.save(parent);

    // Unassigned child linked to parent
    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      status: undefined as never,
      priority: undefined as never,
      assignedAgentType: AgentType.CLAUDE,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
      parentTaskId: parent.id,
    });
    await repo.save(child);

    // Simultaneous updates; assign task and update other fields — assess should still fire exactly once
    const updated = await service.updateTask(child.id as number, {
      assignedAgentRef: 'ide-agent-multi',
      status: TaskStatus.IN_PROGRESS,
      priority: TaskPriority.HIGH,
    });

    expect(updated.parentTaskId).toBe(parent.id);

    const refreshed = await repo.findById(updated.id);
    expect(refreshed?.parentTaskId).toBe(parent.id);

    expect(spyDecomposer.assess).toHaveBeenCalledTimes(1);
  });
});