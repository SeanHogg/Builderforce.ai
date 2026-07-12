import { describe, expect, it } from 'vitest';
import { TaskService } from './TaskService';
import { ITaskRepository } from '../../domain/task/ITaskRepository';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Task } from '../../domain/task/Task';
import { Project } from '../../domain/project/Project';
import {
  asTaskId,
  asProjectId,
  asTenantId,
  asAgentHostId,
} from '../../domain/shared/types';
import { TaskStatus, TaskPriority, TaskType } from '../../domain/shared/types';

// ---------------------------------------------------------------------------
// In-memory repo that tracks which fields were written (to test no overwrites)
// ---------------------------------------------------------------------------
class TrackingTaskRepo implements ITaskRepository {
  private writes: Array<Partial<{ parentTaskId: number | null; assignedAgentRef: string | null }> & { id: number }> =
    [];
  constructor() {}

  async findAll(): Promise<Task[]> {
    return [];
  }
  async findByProjectIds(): Promise<Task[]> {
    return [];
  }
  async findById(id: TaskId): Promise<Task | null> {
    // Return a dummy task with existing parentTaskId for update tests
    const task = Task.reconstitute({
      id: asTaskId(id as number),
      projectId: asProjectId(11),
      key: `BF-${id}`,
      title: `Task ${id}`,
      description: null,
      status: 'backlog' as never,
      priority: 'medium' as never,
      taskType: 'task' as never,
      parentTaskId: id === 42 ? asTaskId(1) : null,
      assignedAgentType: null,
      assignedAgentHostId: null,
      assignedAgentRef: null,
      assignedUserId: null,
      gitBranch: null,
      explicitRepoId: null,
      sprintId: null,
      releaseId: null,
      storyPoints: null,
      businessValue: null,
      businessValueRationale: null,
      businessValueSource: null,
      managerRank: null,
      reviewCount: 0,
      lastReviewedAt: null,
      lastReviewVerdict: null,
      gapOriginTaskId: null,
      githubIssueNumber: null,
      githubIssueUrl: null,
      githubPrUrl: null,
      githubPrNumber: null,
      startDate: null,
      dueDate: null,
      persona: null,
      archived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return task;
  }
  async findChildren(): Promise<Task[]> {
    return [];
  }
  async maxKeySeqByProject(): Promise<number> {
    return 0;
  }
  async rekeyProject(): Promise<number> {
    return 0;
  }
  async save(t: Task): Promise<Task> {
    return t;
  }
  async update(t: Task): Promise<Task> {
    const plain = t.toPlain();
    this.writes.push({
      id: plain.id as number,
      parentTaskId: plain.parentTaskId,
      assignedAgentRef: plain.assignedAgentRef,
    });
    return t;
  }
  async delete(id: TaskId): Promise<void> {
    return;
  }
  async dequeueNextReady(): Promise<Task | null> {
    return null;
  }
}

const TENANT = asTenantId(1);
const PROJECT_ID = asProjectId(11);

function makeProject(): Project {
  return Project.reconstitute({
    id: PROJECT_ID,
    publicId: 'pub-11',
    tenantId: TENANT,
    key: 'BF',
    name: 'BuilderForce',
    description: null,
    template: null,
    rootWorkingDirectory: null,
    status: 'active' as never,
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

class SingleProjectRepo implements IProjectRepository {
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
  async delete(): Promise<void> {
    return;
  }
}

describe('TaskService update preserves parentTaskId (AC-1..AC-4)', () => {
  const repo = new TrackingTaskRepo();

  it('AC-1: parentTaskId in update payload is persisted to database after tasks.update', async () => {
    const service = new TaskService(repo, new SingleProjectRepo(makeProject()));
    const taskId = asTaskId(42);
    // Set up initial state with parentTaskId=1, then update to new parentTaskId=2
    // Update carries parentTaskId, should be persisted
    const updated = await service.updateTask(42, {
      parentTaskId: 2,
      title: 'Updated Title',
    });
    expect(updated.toPlain().parentTaskId).toEqual(asTaskId(2));
    // Verify the write path included parentTaskId
    const writes = repo.writes.filter(w => w.id === 42);
    expect(writes.length).toBe(1);
    expect(writes[0]!.parentTaskId).toEqual(asTaskId(2));
  });

  it('AC-2: parentTaskId is preserved when the same payload also contains assignedAgentRef', async () => {
    repo.writes = [];
    const service = new TaskService(repo, new SingleProjectRepo(makeProject()));
    const taskId = asTaskId(42);
    // Update with both parentTaskId and assignedAgentRef — ensure both survive
    const updated = await service.updateTask(42, {
      parentTaskId: 3,
      assignedAgentRef: 'agent-123',
      title: 'Reassigned Task',
    });
    expect(updated.toPlain().parentTaskId).toEqual(asTaskId(3));
    expect(updated.toPlain().assignedAgentRef).toEqual('agent-123');
    const writes = repo.writes.filter(w => w.id === 42);
    expect(writes.length).toBe(1);
    expect(writes[0]!.parentTaskId).toEqual(asTaskId(3));
    expect(writes[0]!.assignedAgentRef).toEqual('agent-123');
  });

  it('AC-4: update without parentTaskId retains existing stored parentTaskId (no accidental null-out)', async () => {
    repo.writes = [];
    const service = new TaskService(repo, new SingleProjectRepo(makeProject()));
    const taskId = asTaskId(42);
    // Task starts with parentTaskId=1 (set in findById mock). Update with unrelated field only.
    const updated = await service.updateTask(42, {
      status: 'in-progress' as never,
      title: 'Work in Progress',
    });
    // parentTaskId should still be 1, not null
    expect(updated.toPlain().parentTaskId).toEqual(asTaskId(1));
    const writes = repo.writes.filter(w => w.id === 42);
    expect(writes.length).toBe(1);
    expect(writes[0]!.parentTaskId).toEqual(asTaskId(1)); // implicit ?? null = 1
  });

  it('AC-3: auto-run side effects do not clear or overwrite parentTaskId after update (no second write)', async () => {
    repo.writes = [];
    // Task with parentTaskId=1, assign a cloud agent to trigger onAssignedToAgent fan-out path
    const service = new TaskService(repo, new SingleProjectRepo(makeProject()));
    const existing = await repo.findById(asTaskId(42));
    expect(existing?.toPlain().parentTaskId).toEqual(asTaskId(1));
    // Assign without parentTaskId to ensure side effect doesn't drop it
    const assigned = await service.updateTask(42, {
      assignedAgentRef: 'agent-abc',
      title: 'Agent-task',
    });
    // parentTaskId should remain 1, not cleared by side effect
    expect(assigned.toPlain().parentTaskId).toEqual(asTaskId(1));
    // No second write path overwrites parentTaskId (onAssignedToAgent only performs key allocation)
    const writes = repo.writes.filter(w => w.id === 42);
    expect(writes.length).toBe(1);
    expect(writes[0]!.parentTaskId).toEqual(asTaskId(1));
  });
});