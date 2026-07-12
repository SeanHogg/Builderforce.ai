import { describe, expect, it } from 'vitest';
import { TaskService } from './TaskService';
import { ITaskRepository, TaskListOptions } from '../../domain/task/ITaskRepository';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Task } from '../../domain/task/Task';
import { Project } from '../../domain/project/Project';
import {
  ProjectId,
  TaskId,
  TenantId,
  TaskType,
  ProjectStatus,
  asTaskId,
  asProjectId,
  asTenantId,
} from '../../domain/shared/types';

// -------------------------------------------------------------------
// In-memory implementation of ITaskRepository for update-preservation tests.
// -------------------------------------------------------------------
class InMemoryTaskRepo implements ITaskRepository {
  readonly store = new Map<number, Task>();

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
  async maxKeySeqByProject(): Promise<number> {
    return 0;
  }
  async rekeyProject(): Promise<number> {
    return 0;
  }
  async save(): Promise<Task> {
    throw new Error('save is not used in update-preservation tests');
  }
  async update(t: Task): Promise<Task> {
    this.store.set(t.id as number, t);
    return t;
  }
  async delete(): Promise<void> {}
  async dequeueNextReady(): Promise<Task | null> {
    return null;
  }
}

// -------------------------------------------------------------------
// Minimal IProjectRepository for these tests.
// -------------------------------------------------------------------
class InMemoryProjectRepo implements IProjectRepository {
  async findByTenant(): Promise<Project[]> {
    throw new Error('not used in update-preservation tests');
  }
  async findById(): Promise<Project | null> {
    throw new Error('not used in update-preservation tests');
  }
  async findByPublicId(): Promise<Project | null> {
    throw new Error('not used in update-preservation tests');
  }
  async findByKey(): Promise<Project | null> {
    throw new Error('not used in update-preservation tests');
  }
  async save(): Promise<Project> {
    throw new Error('save is not used in update-preservation tests');
  }
  async update(): Promise<Project> {
    throw new Error('update is not used in update-preservation tests');
  }
  async delete(): Promise<void> {}
}

const TENANT = asTenantId(1);
const PROJECT_ID = asProjectId(42);

function makeService() {
  const repo = new InMemoryTaskRepo();
  const project = Project.reconstitute({
    id: PROJECT_ID,
    publicId: 'pub-42',
    tenantId: TENANT,
    key: 'BF-42',
    name: 'BuilderForce',
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
  const projects = new InMemoryProjectRepo(project);
  return new TaskService(repo, projects);
}

describe('Task.update() parentTaskId preservation (AC-1, AC-2, AC-3, AC-4)', () => {
  const taskService = makeService();

  it('preserves parentTaskId when parentTaskId is omitted from updatePayload', async () => {
    const parentId = 123;
    const taskId = asTaskId(1);
    // Parent task
    const parent = Task.reconstitute({
      id: asTaskId(parentId),
      projectId: PROJECT_ID,
      key: 'BF-P-001',
      title: 'Parent Epic',
      description: null,
      status: 'backlog' as never,
      priority: 'medium' as never,
      taskType: 'epic' as never,
      parentTaskId: null,
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
    taskService['tasks'].update(parent);

    // Child task with parentTaskId
    const childBeforeSave = Task.reconstitute({
      id: taskId,
      projectId: PROJECT_ID,
      key: 'BF-001',
      title: 'Child Task',
      description: null,
      status: 'backlog' as never,
      priority: 'medium' as never,
      taskType: 'task' as never,
      parentTaskId: parentId as TaskId,
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
    const saved = taskService['tasks'].update(childBeforeSave);
    // Assignment-only update (no parentTaskId)
    await taskService.updateTask(taskId as number, { assignedAgentRef: 'agent-7' });

    const fresh = await taskService.getTask(taskId as number);
    expect(fresh.parentTaskId).toBe(saved.parentTaskId);
    expect(fresh.parentTaskId).toBe(parentId);
  });

  it('clears parentTaskId when explicitly set to null', async () => {
    const parentId = 124;
    const taskId = asTaskId(2);
    // Parent task
    const parent = Task.reconstitute({
      id: asTaskId(parentId),
      projectId: PROJECT_ID,
      key: 'BF-P-002',
      title: 'Parent Epic',
      description: null,
      status: 'backlog' as never,
      priority: 'medium' as never,
      taskType: 'epic' as never,
      parentTaskId: null,
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
    taskService['tasks'].update(parent);

    // Child task with parentTaskId
    const childBeforeSave = Task.reconstitute({
      id: taskId,
      projectId: PROJECT_ID,
      key: 'BF-002',
      title: 'Child Task',
      description: null,
      status: 'backlog' as never,
      priority: 'medium' as never,
      taskType: 'task' as never,
      parentTaskId: parentId as TaskId,
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
    const saved = taskService['tasks'].update(childBeforeSave);
    // Explicit null to clear the relationship
    await taskService.updateTask(taskId as number, { parentTaskId: null });

    const fresh = await taskService.getTask(taskId as number);
    expect(fresh.parentTaskId).toBeNull();
    expect(fresh.parentTaskId).toBe(saved.parentTaskId);
  });

  it('updates to a new parentTaskId', async () => {
    const oldParentId = 125;
    const newParentId = 126;
    const taskId = asTaskId(3);
    // Old parent
    const oldParent = Task.reconstitute({
      id: asTaskId(oldParentId),
      projectId: PROJECT_ID,
      key: 'BF-P-003',
      title: 'Old Parent Epic',
      description: null,
      status: 'backlog' as never,
      priority: 'medium' as never,
      taskType: 'epic' as never,
      parentTaskId: null,
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
    taskService['tasks'].update(oldParent);

    // New parent
    const newParent = Task.reconstitute({
      id: asTaskId(newParentId),
      projectId: PROJECT_ID,
      key: 'BF-P-004',
      title: 'New Parent Epic',
      description: null,
      status: 'backlog' as never,
      priority: 'medium' as never,
      taskType: 'epic' as never,
      parentTaskId: null,
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
    taskService['tasks'].update(newParent);

    // Child task initially under old parent
    const childBeforeSave = Task.reconstitute({
      id: taskId,
      projectId: PROJECT_ID,
      key: 'BF-003',
      title: 'Child Task',
      description: null,
      status: 'backlog' as never,
      priority: 'medium' as never,
      taskType: 'task' as never,
      parentTaskId: oldParentId as TaskId,
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
    const saved = taskService['tasks'].update(childBeforeSave);
    // Assignment-only update (no parentTaskId) — preserves existing parent
    await taskService.updateTask(taskId as number, { assignedAgentRef: 'agent-8' });

    const fresh = await taskService.getTask(taskId as number);
    expect(fresh.parentTaskId).toBe(oldParentId);
    expect(fresh.parentTaskId).toBe(saved.parentTaskId);

    // Now change parent explicitly
    await taskService.updateTask(taskId as number, { parentTaskId: newParentId });

    const freshAfterMove = await taskService.getTask(taskId as number);
    expect(freshAfterMove.parentTaskId).toBe(newParentId);
    expect(freshAfterMove.parentTaskId).toBe(newParentId);
  });

  it('keeps parentTaskId=null when it is null and assignment-only update is applied', async () => {
    const taskId = asTaskId(4);
    const topTask = Task.reconstitute({
      id: taskId,
      projectId: PROJECT_ID,
      key: 'BF-004',
      title: 'Top-level Task',
      description: null,
      status: 'backlog' as never,
      priority: 'medium' as never,
      taskType: 'task' as never,
      parentTaskId: null,
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
    const saved = taskService['tasks'].update(topTask);
    // Assignment-only update (no parentTaskId) — preserves null parent
    await taskService.updateTask(taskId as number, { assignedAgentRef: 'agent-9' });

    const fresh = await taskService.getTask(taskId as number);
    expect(fresh.parentTaskId).toBeNull();
    expect(fresh.parentTaskId).toBe(saved.parentTaskId);
  });
});