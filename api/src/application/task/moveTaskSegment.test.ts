import { describe, expect, it } from 'vitest';
import { TaskService } from './TaskService';
import type { ITaskRepository } from '../../domain/task/ITaskRepository';
import type { IProjectRepository } from '../../domain/project/IProjectRepository';
import { Task } from '../../domain/task/Task';
import { Project } from '../../domain/project/Project';
import { ProjectId, TaskId, ProjectStatus, asTaskId, asProjectId, asTenantId } from '../../domain/shared/types';

/**
 * A MOVE CARRIES THE TICKET'S ISOLATION SEGMENT WITH IT.
 *
 * `tasks.segment_id` is stamped by an INSERT trigger and is not a domain field, so a
 * cross-board move used to leave the ticket in the SOURCE project's segment — visible to
 * the segment it left, invisible to the one it joined. The re-point now rides the same
 * `update` as the project change, so there is no window where the two disagree.
 */

const TENANT = asTenantId(1);
const SOURCE = asProjectId(11);
const TARGET = asProjectId(22);

function makeProject(id: ProjectId, key: string): Project {
  return Project.reconstitute({
    id, publicId: `pub-${id}`, tenantId: TENANT, key, name: key, description: null, template: null,
    rootWorkingDirectory: null, status: ProjectStatus.ACTIVE, sourceControlIntegrationId: null,
    sourceControlProvider: null, sourceControlRepoFullName: null, sourceControlRepoUrl: null,
    githubRepoUrl: null, githubRepoOwner: null, githubRepoName: null, governance: null, modality: null,
    origin: null, initiativeId: null, companyId: null, dueDate: null, startDate: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

function makeTask(): Task {
  return Task.reconstitute({
    id: asTaskId(7), projectId: SOURCE, key: 'SRC-7', title: 'Move me', description: null,
    status: 'backlog' as never, priority: 'medium' as never, taskType: 'task' as never,
    parentTaskId: null, assignedAgentType: null, assignedAgentHostId: null, assignedAgentRef: null,
    assignedUserId: null, gitBranch: null, explicitRepoId: null, sprintId: null, releaseId: null,
    storyPoints: null, businessValue: null, businessValueRationale: null, businessValueSource: null,
    managerRank: null, reviewCount: 0, lastReviewedAt: null, lastReviewVerdict: null, gapOriginTaskId: null,
    githubIssueNumber: null, githubIssueUrl: null, githubPrUrl: null, githubPrNumber: null,
    startDate: null, decompositionSource: null, dueDate: null, persona: null, archived: false,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

class RecordingTaskRepo implements ITaskRepository {
  readonly updates: Array<{ projectId: number; key: string; isolation?: { segmentId: string | null } }> = [];
  constructor(private readonly task: Task) {}
  async findAll(): Promise<Task[]> { return [this.task]; }
  async findByProjectIds(): Promise<Task[]> { return [this.task]; }
  async findById(id: TaskId): Promise<Task | null> { return (id as number) === 7 ? this.task : null; }
  async findChildren(): Promise<Task[]> { return []; }
  async maxKeySeqByProject(): Promise<number> { return 3; }
  async rekeyProject(): Promise<number> { return 0; }
  async save(t: Task): Promise<Task> { return t; }
  async update(t: Task, isolation?: { segmentId: string | null }): Promise<Task> {
    this.updates.push({ projectId: t.projectId as number, key: t.toPlain().key, isolation });
    return t;
  }
  async delete(): Promise<void> {}
  async dequeueNextReady(): Promise<Task | null> { return null; }
}

class TwoProjectRepo implements IProjectRepository {
  constructor(private readonly segments: Record<number, string | null>) {}
  private readonly byId: Record<number, Project> = {
    [SOURCE as number]: makeProject(SOURCE, 'SRC'),
    [TARGET as number]: makeProject(TARGET, 'TGT'),
  };
  async segmentIdOf(id: ProjectId): Promise<string | null> { return this.segments[id as number] ?? null; }
  async findByTenant(): Promise<Project[]> { return Object.values(this.byId); }
  async findById(id: ProjectId): Promise<Project | null> { return this.byId[id as number] ?? null; }
  async findByPublicId(): Promise<Project | null> { return null; }
  async findByKey(): Promise<Project | null> { return null; }
  async save(p: Project): Promise<Project> { return p; }
  async update(p: Project): Promise<Project> { return p; }
  async delete(): Promise<void> {}
}

describe('TaskService.moveTask re-points tasks.segment_id', () => {
  it('writes the TARGET project segment in the same update as the project change', async () => {
    const repo = new RecordingTaskRepo(makeTask());
    const service = new TaskService(repo, new TwoProjectRepo({ [SOURCE as number]: 'seg-src', [TARGET as number]: 'seg-tgt' }));

    await service.moveTask(7, TARGET as number, TENANT as number);

    expect(repo.updates).toHaveLength(1);
    expect(repo.updates[0]).toEqual({ projectId: TARGET as number, key: 'TGT-004', isolation: { segmentId: 'seg-tgt' } });
  });

  it('passes a null segment through for an unsegmented target (the repository leaves the column)', async () => {
    const repo = new RecordingTaskRepo(makeTask());
    const service = new TaskService(repo, new TwoProjectRepo({}));

    await service.moveTask(7, TARGET as number, TENANT as number);

    expect(repo.updates[0]?.isolation).toEqual({ segmentId: null });
  });

  it('writes nothing when the task is already on the target board', async () => {
    const repo = new RecordingTaskRepo(makeTask());
    const service = new TaskService(repo, new TwoProjectRepo({ [SOURCE as number]: 'seg-src' }));

    await service.moveTask(7, SOURCE as number, TENANT as number);

    expect(repo.updates).toHaveLength(0);
  });
});
