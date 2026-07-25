import { describe, expect, it } from 'vitest';
import { TaskService } from './TaskService';
import { EpicDecomposer, heuristicEpicDecomposer, checklistItemTitle } from './EpicDecomposer';
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

function makeService(decomposer?: EpicDecomposer) {
  const repo = new InMemoryTaskRepo();
  const projects = new InMemoryProjectRepo(makeProject());
  /** Records the precedence edges fan-out asks for, so sequencing is assertable. */
  const edges: Array<{ predecessorTaskId: number; successorTaskId: number }> = [];
  const service = new TaskService(repo, projects, decomposer, undefined,
    async (_projectId, predecessorTaskId, successorTaskId) => {
      edges.push({ predecessorTaskId, successorTaskId });
    });
  return { repo, service, edges };
}

/** A bare unsaved task, for exercising a decomposer's `assess` directly. */
function makeTask(title: string, description: string | null): Task {
  return Task.create({
    projectId: PROJECT_ID,
    title,
    description,
    status: undefined as never,
    priority: undefined as never,
    assignedAgentType: null,
    assignedAgentHostId: null,
    startDate: null,
    dueDate: null,
    persona: null,
    projectKey: 'ACME',
    lastKeySeq: 0,
  });
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
      lastKeySeq: 0,
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
      lastKeySeq: 0,
    });
    const plan = await heuristicEpicDecomposer.assess(task);
    expect(plan.isEpic).toBe(false);
    expect(plan.children).toHaveLength(0);
  });
});

describe('checklistItemTitle — what is NOT a work item', () => {
  it('rejects a markdown sub-header masquerading as a bullet', () => {
    // The exact shape that filled the board with markdown fragments.
    expect(checklistItemTitle('- **API Endpoints**:')).toBeNull();
    expect(checklistItemTitle('  - **Data Model**:')).toBeNull();
    expect(checklistItemTitle('### Data model')).toBeNull();
  });

  it('keeps the CLAUSE after a leading label and drops the label', () => {
    expect(checklistItemTitle('- **Data Model**: Create a Capability entity'))
      .toBe('Create a Capability entity');
    expect(checklistItemTitle('- **Health Score**: Compute a simple health score'))
      .toBe('Compute a simple health score');
  });

  it('rejects a one-word category', () => {
    expect(checklistItemTitle('- Backend')).toBeNull();
    expect(checklistItemTitle('- **Testing**')).toBeNull();
  });

  it('still accepts ordinary checklist work', () => {
    expect(checklistItemTitle('- [ ] Design the schema')).toBe('Design the schema');
    expect(checklistItemTitle('* Add the invite route')).toBe('Add the invite route');
    expect(checklistItemTitle('1. Wire the webhook handler')).toBe('Wire the webhook handler');
  });

  it('ignores prose that is not a bullet at all', () => {
    expect(checklistItemTitle('Just fix the typo on the login page.')).toBeNull();
    expect(checklistItemTitle('')).toBeNull();
  });
});

describe('heuristicEpicDecomposer — document guard', () => {
  it('refuses to shred a long document into tickets', async () => {
    const doc = Array.from({ length: 30 }, (_, i) => `- Implement the thing number ${i}`).join('\n');
    const task = makeTask('Big spec', doc);
    const plan = await heuristicEpicDecomposer.assess(task);
    // 30 parsed bullets means this is a spec, not a checklist.
    expect(plan.isEpic).toBe(false);
    expect(plan.children).toHaveLength(0);
  });

  it('reports itself as the heuristic source', async () => {
    const plan = await heuristicEpicDecomposer.assess(
      makeTask('Build onboarding', '- [ ] Design the schema\n- [ ] Add the API routes'),
    );
    expect(plan.source).toBe('heuristic');
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
      lastKeySeq: 0,
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
          source: 'llm' as const,
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

describe('TaskService.decomposeEpic — scheduling + sequencing (0364)', () => {
  const plan: EpicDecomposer = {
    async assess() {
      return {
        isEpic: true,
        source: 'llm' as const,
        children: [
          { title: 'Design the schema', estimateDays: 3 },
          { title: 'Build the API', estimateDays: 2, dependsOnIndex: 0 },
          { title: 'Write the docs', estimateDays: 1 },
        ],
      };
    },
  };

  it('gives every fanned-out child a real start AND due date', async () => {
    const { repo, service } = makeService(plan);
    const epic = await service.createTask(
      { projectId: PROJECT_ID as number, title: 'Onboarding', assignedAgentRef: 'planner' },
      TENANT as number,
    );
    const children = await repo.findChildren(epic.id);
    expect(children).toHaveLength(3);
    for (const child of children) {
      expect(child.startDate).toBeInstanceOf(Date);
      expect(child.dueDate).toBeInstanceOf(Date);
      expect(child.dueDate!.getTime()).toBeGreaterThanOrEqual(child.startDate!.getTime());
    }
  });

  it('starts a dependent child AFTER its predecessor finishes, and parallel work together', async () => {
    const { repo, service } = makeService(plan);
    const epic = await service.createTask(
      { projectId: PROJECT_ID as number, title: 'Onboarding', assignedAgentRef: 'planner' },
      TENANT as number,
    );
    const children = await repo.findChildren(epic.id);
    const byTitle = new Map(children.map((c) => [c.title, c]));
    const design = byTitle.get('Design the schema')!;
    const api = byTitle.get('Build the API')!;
    const docs = byTitle.get('Write the docs')!;

    expect(api.startDate!.getTime()).toBeGreaterThan(design.dueDate!.getTime());
    // 'Write the docs' declared no dependency, so it runs alongside the first item.
    expect(docs.startDate!.getTime()).toBe(design.startDate!.getTime());
  });

  it('records the declared sequence as a real precedence edge', async () => {
    const { repo, service, edges } = makeService(plan);
    const epic = await service.createTask(
      { projectId: PROJECT_ID as number, title: 'Onboarding', assignedAgentRef: 'planner' },
      TENANT as number,
    );
    const children = await repo.findChildren(epic.id);
    const design = children.find((c) => c.title === 'Design the schema')!;
    const api = children.find((c) => c.title === 'Build the API')!;
    expect(edges).toEqual([
      { predecessorTaskId: design.id as number, successorTaskId: api.id as number },
    ]);
  });

  it('back-fills the undated Epic with the span of its children', async () => {
    const { repo, service } = makeService(plan);
    const epic = await service.createTask(
      { projectId: PROJECT_ID as number, title: 'Onboarding', assignedAgentRef: 'planner' },
      TENANT as number,
    );
    const stored = (await repo.findById(epic.id))!;
    const children = await repo.findChildren(epic.id);
    const earliest = Math.min(...children.map((c) => c.startDate!.getTime()));
    const latest = Math.max(...children.map((c) => c.dueDate!.getTime()));
    expect(stored.startDate!.getTime()).toBe(earliest);
    expect(stored.dueDate!.getTime()).toBe(latest);
  });

  it('stamps WHICH decomposer produced the plan', async () => {
    const { repo, service } = makeService(plan);
    const epic = await service.createTask(
      { projectId: PROJECT_ID as number, title: 'Onboarding', assignedAgentRef: 'planner' },
      TENANT as number,
    );
    expect((await repo.findById(epic.id))!.decompositionSource).toBe('llm');
  });

  it('refuses to duplicate children on a second decompose, and reconciles with replace', async () => {
    const { repo, service } = makeService(plan);
    const epic = await service.createTask(
      { projectId: PROJECT_ID as number, title: 'Onboarding', assignedAgentRef: 'planner' },
      TENANT as number,
    );
    const first = await repo.findChildren(epic.id);
    expect(first).toHaveLength(3);

    await expect(
      service.decomposeEpic(epic.id as number, [{ title: 'Design the schema' }]),
    ).rejects.toThrow(/already decomposed/i);
    expect(await repo.findChildren(epic.id)).toHaveLength(3);

    // With replace, a title that already exists is re-scheduled, not re-created.
    await service.decomposeEpic(
      epic.id as number,
      [{ title: 'Design the schema' }, { title: 'Add the audit trail' }],
      { replace: true },
    );
    const after = await repo.findChildren(epic.id);
    expect(after).toHaveLength(4);
    expect(after.filter((c) => c.title === 'Design the schema')).toHaveLength(1);
  });
});

describe('TaskService.getEpicTree', () => {
  it('returns the Epic and its direct children', async () => {
    const { service } = makeService();
    const epic = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Build onboarding',
        // Multi-word items on purpose: a single-word bullet is a category, not an
        // assignable unit of work, and the parser now rejects it.
        description: '- [ ] Add the invite route\n- [ ] Add the welcome email',
        assignedAgentRef: 'ide-agent-9',
      },
      TENANT as number,
    );
    const tree = await service.getEpicTree(epic.id as number);
    expect(tree.epic.id).toBe(epic.id);
    expect(tree.children.map(c => c.title)).toEqual(['Add the invite route', 'Add the welcome email']);
  });
});
