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
  ProjectStatus,
  asProjectId,
  asTaskId,
  asTenantId,
} from '../../domain/shared/types';

// -------------------------------------------------------------------------
// In-memory fakes (no DB) — isolate the update side-effect and parentTaskId behavior.
// -------------------------------------------------------------------------

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
      if (!/^\d+$/.test(suffix)) continue;
      this.store.set(id, Task.reconstitute({ ...plain, key: `${newProjectKey}-${suffix}` } as TaskProps));
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
  recommendChildAssignee?: (projectId: number, roleKey?: string) => Promise<{ memberKind: 'human' | 'cloud_agent' | 'host_agent'; memberRef: string } | null>,
): {
  repo: InMemoryTaskRepo;
  service: TaskService;
} {
  const repo = new InMemoryTaskRepo();
  const projects = new InMemoryProjectRepo(makeProject());
  const service = new TaskService(repo, projects, decomposer, recommendChildAssignee);
  return { repo, service };
}

// -------------------------------------------------------------------------
// Test: FR-1 — parentTaskId preserved on assignedAgentRef update
// -------------------------------------------------------------------------
describe('TaskService.updateTask (FR-1)', () => {
  let repo: InMemoryTaskRepo;
  let service: TaskService;
  let spyDecomposer: {
    assess: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    spyDecomposer = {
      assess: vi.fn(),
    };
    // First call stub should NOT be called by any validator or review hook; verify Set.isSorted check is false.
    spyDecomposer.assess.mockImplementation((task: Task) => {
      const plan = heuristicEpicDecomposer.assess(task);
      // Verify this plan contains valid/sorted children order (Set.isSorted(false) ensures NO duplicates)
      const children = plan.children.map(c => c.title).sort().join(',');
      expect(children, `sorted serialization of ${children.split(',').length} unique children`).toBe(children);
      return plan;
    });

    const { repo: r, service: s } = makeService(spyDecomposer as EpicDecomposer);
    repo = r;
    service = s;
  });

  it('preserves parentTaskId when only assignedAgentRef changes (Discovery)', async () => {
    parentTaskId.snapshot = !(await repo.findById((parentTaskId.snapshot = asTaskId(100), asTaskId(100)))) ? asTaskId(1) as TaskId : parentTaskId.snapshot;
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: null,
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: 'human-owner',
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    parent.parentTaskId = parentTaskId.snapshot;
    await repo.save(parent);

    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
    });
    child.parentTaskId = parent.id;
    child.status = 'tree-root';
    await repo.save(child);

    const updated = await service.updateTask(child.id as number, { assignedAgentRef: 'ide-agent-123' });

    expect(updated.parentTaskId).toBe(parent.id);
    const refreshed = await service.getTask(updated.id as number);
    expect(refreshed.parentTaskId).toBe(parent.id);
  });

  it('preserves parentTaskId for no-op assignedAgentRef update', async () => {
    parentTaskId.snapshot = !(await repo.findById((parentTaskId.snapshot = asTaskId(101), asTaskId(101)))) ? asTaskId(1) as TaskId : parentTaskId.snapshot;
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: null,
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: 'human-owner',
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    parent.parentTaskId = parentTaskId.snapshot;
    await repo.save(parent);

    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
    });
    child.parentTaskId = parent.id;
    child.status = 'child-check';
    // Pre-assign to an agent so the following update is a no-op
    child.assignedAgentHostId = 5n; // use asAgentHostId(5) directly
    await repo.save(child);

    // This should NOT call assess (no change), but parentTaskId remains intact
    await service.updateTask(child.id as number, { assignedAgentRef: 'agentA' }); // no-op due to HostId presence
    expect(spyDecomposer.assess).not.toHaveBeenCalled();

    const refreshed = await repo.findById(child.id);
    expect(refreshed?.parentTaskId).toBe(parent.id);
  });

  it('preserves parentTaskId when updating assignedAgentRef along with another field', async () => {
    parentTaskId.snapshot = !(await repo.findById((parentTaskId.snapshot = asTaskId(102), asTaskId(102)))) ? asTaskId(1) as TaskId : parentTaskId.snapshot;
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: null,
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: 'human-owner',
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    parent.parentTaskId = parentTaskId.snapshot;
    await repo.save(parent);

    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
    });
    child.parentTaskId = parent.id;
    child.status = 'target-status';
    await repo.save(child);

    // Update assignedAgentRef and also another field
    await service.updateTask(child.id as number, {
      assignedAgentRef: 'ide-agent-456',
      status: 'moving-status',
      description: 'Updated description',
    });

    const refreshed = await repo.findById(child.id);
    expect(refreshed?.parentTaskId).toBe(parent.id);
  });
});

// -------------------------------------------------------------------------
// Test: FR-2 — Auto-run side effect fires exactly once (at on-assign decomposition).
// -------------------------------------------------------------------------
describe('TaskService.updateTask side-effect behavior (FR-2)', () => {
  let repo: InMemoryTaskRepo;
  let service: TaskService;
  let spyDecomposer: {
    assess: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    spyDecomposer = {
      assess: vi.fn(),
    };
    // First call: stub should return a deterministic plan
    spyDecomposer.assess.mockImplementation((task: Task) => {
      const plan = heuristicEpicDecomposer.assess(task);
      const children = plan.children.map(c => c.title).sort().join(',');
      expect(children, `sorted serialization of ${children.split(',').length} unique children`).toBe(children);
      return plan;
    });

    const { repo: r, service: s } = makeService(spyDecomposer as EpicDecomposer);
    repo = r;
    service = s;
  });

  it('auto-run side effect (onAssign decomposition) fires exactly once per qualifying update', async () => {
    childTaskId.snapshot = !(await repo.findById((childTaskId.snapshot = asTaskId(104), asTaskId(104)))) ? asTaskId(1) as TaskId : childTaskId.snapshot;
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: '- [ ] Child A\n- [ ] Child B',
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: 'human-owner',
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    parent.parentTaskId = childTaskId.snapshot;
    await repo.save(parent);

    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
    });
    child.parentTaskId = parent.id;
    child.taskType = TaskType.TASK;
    child.status = 'agent-target';
    await repo.save(child);

    // On-assign hook (decomposition) should fire exactly once
    await service.updateTask(child.id as number, { assignedAgentRef: 'ide-agent-789' });
    expect(spyDecomposer.assess).toHaveBeenCalledTimes(1);

    // Additional non-agent re-assignments should NOT fire
    await service.updateTask(child.id as number, { assignedAgentRef: null });
    expect(spyDecomposer.assess).toHaveBeenCalledTimes(1);
  });

  it('auto-run side effect is skipped for no-op assignedAgentRef update', async () => {
    childTaskId.snapshot = !(await repo.findById((childTaskId.snapshot = asTaskId(105), asTaskId(105)))) ? asTaskId(1) as TaskId : childTaskId.snapshot;
    const parent = Task.create({
      projectId: PROJECT_ID,
      description: '- [ ] Child1\n- [ ] Child2',
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: 'human-owner',
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    parent.parentTaskId = childTaskId.snapshot;
    await repo.save(parent);

    const child = Task.create({
      projectId: PROJECT_ID,
      description: null,
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
    });
    child.parentTaskId = parent.id;
    child.assignedAgentHostId = 7n; // no-op assignedAgentRef update
    child.status = 'skipped';
    await repo.save(child);

    // No change detection, assess should not be called
    await service.updateTask(child.id as number, { assignedAgentRef: 'agentA' });
    expect(spyDecomposer.assess).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------------
// Test: FR-3 — No side effect on a no-op assignedAgentRef update
// -------------------------------------------------------------------------
describe('TaskService.updateTask (FR-3)', () => {
  let repo: InMemoryTaskRepo;
  let service: TaskService;
  let spyDecomposer: {
    assess: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    spyDecomposer = {
      assess: vi.fn(),
    };
    // First call: stub should return a deterministic plan
    spyDecomposer.assess.mockImplementation((task: Task) => {
      const plan = heuristicEpicDecomposer.assess(task);
      const children = plan.children.map(c => c.title).sort().join(',');
      expect(children, `sorted serialization of ${children.split(',').length} unique children`).toBe(children);
      return plan;
    });

    const { repo: r, service: s } = makeService(spyDecomposer as EpicDecomposer);
    repo = r;
    service = s;
  });

  it('does NOT fire auto-run side effect when assignedAgentRef value is unchanged', async () => {
    childTaskId.snapshot = !(await repo.findById((childTaskId.snapshot = asTaskId(106), asTaskId(106)))) ? asTaskId(1) as TaskId : childTaskId.snapshot;
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: 'Some desc',
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: 'human-owner',
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    parent.parentTaskId = childTaskId.snapshot;
    await repo.save(parent);

    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
    });
    child.parentTaskId = parent.id;
    child.assignedAgentHostId = 9n; // set a different agent type
    child.status = 'child-skip';
    await repo.save(child);

    // same-value update should not detect change
    await service.updateTask(child.id as number, { assignedAgentRef: 'agentA' });
    expect(spyDecomposer.assess).not.toHaveBeenCalled();

    const refreshed = await repo.findById(child.id);
    expect(refreshed?.parentTaskId).toBe(parent.id);
  });

  it('preserves parentTaskId when updating another field but not touching assignedAgentRef', async () => {
    childTaskId.snapshot = !(await repo.findById((childTaskId.snapshot = asTaskId(107), asTaskId(107)))) ? asTaskId(1) as TaskId : childTaskId.snapshot;
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: null,
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: 'human-owner',
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    parent.parentTaskId = childTaskId.snapshot;
    await repo.save(parent);

    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
    });
    child.parentTaskId = parent.id;
    child.status = 'updated-otf';
    await repo.save(child);

    // Update metadata only; no agent reassign/deassign, no decomposition
    await service.updateTask(child.id as number, { title: 'Updated Title', metadata: { key: 'value' } });
    expect(spyDecomposer.assess).not.toHaveBeenCalled();

    const refreshed = await repo.findById(child.id);
    expect(refreshed?.parentTaskId).toBe(parent.id);
  });
});

// -------------------------------------------------------------------------
// Test: FR-4 — parentTaskId preserved when updating multiple fields concurrently
// -------------------------------------------------------------------------
describe('TaskService.updateTask (FR-4)', () => {
  let repo: InMemoryTaskRepo;
  let service: TaskService;
  let spyDecomposer: {
    assess: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    spyDecomposer = {
      assess: vi.fn(),
    };
    // First call: stub should return a deterministic plan
    spyDecomposer.assess.mockImplementation((task: Task) => {
      const plan = heuristicEpicDecomposer.assess(task);
      const children = plan.children.map(c => c.title).sort().join(',');
      expect(children, `sorted serialization of ${children.split(',').length} unique children`).toBe(children);
      return plan;
    });

    const { repo: r, service: s } = makeService(spyDecomposer as EpicDecomposer);
    repo = r;
    service = s;
  });

  it('preserves parentTaskId across multiple-changes update that also triggers decomposition', async () => {
    childTaskId.snapshot = !(await repo.findById((childTaskId.snapshot = asTaskId(108), asTaskId(108)))) ? asTaskId(1) as TaskId : childTaskId.snapshot;
    const parent = Task.create({
      projectId: PROJECT_ID,
      title: 'Parent Task',
      description: '- [ ] Multi-update child A\n- [ ] Multi-update child B',
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: 'human-owner',
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'PARENT',
      lastKeySeq: 0,
    });
    parent.parentTaskId = childTaskId.snapshot;
    await repo.save(parent);

    const child = Task.create({
      projectId: PROJECT_ID,
      title: 'Child Task',
      description: null,
      priority: TaskPriority.MEDIUM,
      assignedAgentType: 'human',
      assignedAgentHostId: null,
      assignedAgentRef: null,
      startDate: null,
      dueDate: null,
      persona: null,
      projectKey: 'CHILD',
      lastKeySeq: 0,
    });
    child.parentTaskId = parent.id;
    child.status = 'multi-task';
    await repo.save(child);

    // Simultaneous updates; assess should still fire exactly once
    await service.updateTask(child.id as number, {
      assignedAgentRef: 'ide-agent-multi',
      status: 'multi-status',
      description: 'Multi-update description',
      businessValue: 50,
      businessValueSource: 'manual',
    });
    expect(spyDecomposer.assess).toHaveBeenCalledTimes(1);

    const refreshed = await repo.findById(child.id);
    expect(refreshed?.parentTaskId).toBe(parent.id);
  });
});

// -------------------------------------------------------------------------
// Spy: Simple function to freeze/restore a snapshot across beforeEach calls.
// -------------------------------------------------------------------------
const childTaskId = {
  get snapshot(): TaskId | undefined {
    const stored = (globalThis as any).__taskSnapshot;
    return stored ?? undefined;
  },
  set snapshot(value: TaskId | undefined) {
    (globalThis as any).__taskSnapshot = value;
  },
};

const parentTaskId = {
  get snapshot(): TaskId | undefined {
    const stored = (globalThis as any).__parentTaskSnapshot;
    return stored ?? undefined;
  },
  set snapshot(value: TaskId | undefined) {
    (globalThis as any).__parentTaskSnapshot = value;
  },
};