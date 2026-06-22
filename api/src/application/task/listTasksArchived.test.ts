import { describe, expect, it } from 'vitest';
import { TaskService } from './TaskService';
import { ITaskRepository, TaskListOptions } from '../../domain/task/ITaskRepository';
import { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Task } from '../../domain/task/Task';
import { Project } from '../../domain/project/Project';
import {
  ProjectId, TaskId, ProjectStatus,
  asTaskId, asProjectId, asTenantId,
} from '../../domain/shared/types';

// ---------------------------------------------------------------------------
// Archive-aware in-memory fake: honors TaskListOptions so we exercise the
// "hide archived by default" contract that the board / brain list_tasks rely on.
// ---------------------------------------------------------------------------
class ArchiveAwareTaskRepo implements ITaskRepository {
  constructor(private readonly tasks: Task[]) {}
  private visible(rows: Task[], opts?: TaskListOptions): Task[] {
    return opts?.includeArchived ? rows : rows.filter(t => !t.toPlain().archived);
  }
  async findAll(projectId?: ProjectId, opts?: TaskListOptions): Promise<Task[]> {
    const rows = projectId === undefined
      ? this.tasks
      : this.tasks.filter(t => (t.projectId as number) === (projectId as number));
    return this.visible(rows, opts);
  }
  async findByProjectIds(ids: ProjectId[], opts?: TaskListOptions): Promise<Task[]> {
    const set = new Set(ids.map(i => i as number));
    return this.visible(this.tasks.filter(t => set.has(t.projectId as number)), opts);
  }
  async findById(id: TaskId): Promise<Task | null> {
    return this.tasks.find(t => (t.toPlain().id as number) === (id as number)) ?? null;
  }
  async findChildren(): Promise<Task[]> { return []; }
  async maxKeySeqByProject(): Promise<number> { return 0; }
  async save(t: Task): Promise<Task> { return t; }
  async update(t: Task): Promise<Task> { return t; }
  async delete(): Promise<void> {}
  async dequeueNextReady(): Promise<Task | null> { return null; }
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
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

class SingleProjectRepo implements IProjectRepository {
  constructor(private readonly project: Project) {}
  async findByTenant(): Promise<Project[]> { return [this.project]; }
  async findById(): Promise<Project | null> { return this.project; }
  async findByPublicId(): Promise<Project | null> { return this.project; }
  async findByKey(): Promise<Project | null> { return this.project; }
  async save(p: Project): Promise<Project> { return p; }
  async update(p: Project): Promise<Project> { return p; }
  async delete(): Promise<void> {}
}

function makeTask(id: number, archived: boolean): Task {
  return Task.reconstitute({
    id: asTaskId(id),
    projectId: PROJECT_ID,
    key: `BF-${id}`,
    title: `Task ${id}`,
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
    githubIssueNumber: null,
    githubIssueUrl: null,
    githubPrUrl: null,
    githubPrNumber: null,
    startDate: null,
    dueDate: null,
    persona: null,
    archived,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('TaskService.listTasks archived filtering', () => {
  const tasks = [makeTask(1, false), makeTask(2, true), makeTask(3, false)];

  it('excludes archived tasks by default (project-scoped)', async () => {
    const service = new TaskService(new ArchiveAwareTaskRepo(tasks), new SingleProjectRepo(makeProject()));
    const result = await service.listTasks(TENANT as number, PROJECT_ID as number);
    expect(result.map(t => t.toPlain().id as number)).toEqual([1, 3]);
  });

  it('includes archived tasks when includeArchived is set', async () => {
    const service = new TaskService(new ArchiveAwareTaskRepo(tasks), new SingleProjectRepo(makeProject()));
    const result = await service.listTasks(TENANT as number, PROJECT_ID as number, true);
    expect(result.map(t => t.toPlain().id as number)).toEqual([1, 2, 3]);
  });

  it('excludes archived tasks by default (tenant-wide, no project filter)', async () => {
    const service = new TaskService(new ArchiveAwareTaskRepo(tasks), new SingleProjectRepo(makeProject()));
    const result = await service.listTasks(TENANT as number);
    expect(result.map(t => t.toPlain().id as number)).toEqual([1, 3]);
  });
});
