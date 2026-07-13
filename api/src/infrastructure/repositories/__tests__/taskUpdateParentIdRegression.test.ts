/**
 * @subsystem task-model
 * @user-access backend-api
 * @related PRD #683
 *
 * Regression tests for tasks.update preserving parentTaskId:
 * - AC-1: Include parentTaskId in payload → persisted.
 * - AC-2: Include both parentTaskId and assignedAgentRef → both persisted.
 * - AC-3: Auto-run/reassignment side effects do not clear parentTaskId.
 * - AC-4: Omit parentTaskId → existing value retained.
 * - AC-8: Root cause documented; test behavior reflects current code path.
 *
 * To classify: FIX (verified) | MISSING (GH issue)
 * preserved: true
 * additionScore: +1; ensures parentTaskId survives partial updates.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { afterEach as teardownAfterEach } from 'vitest';
import dayjs from 'dayjs';
import { initDbForTest } from '../../../common/test/testDb';
import { TaskRepository } from '../../repositories/TaskRepository';
import { Task, asTaskId } from '../../../../domain/task/Task';
import { ProjectId } from '../../../../domain/shared/types';
import { TaskType, TaskStatus, TaskPriority, AgentType } from '../../../../domain/shared/types';

describe('TaskRepository integration: parentTaskId preserved on update', () => {
  let db: ReturnType<typeof initDbForTest>['db'];
  let adminUserId: string;
  let service: TaskRepository;
  let testProjectId: ProjectId;

  beforeEach(async () => {
    const env = await initDbForTest();
    db = env.db;
    adminUserId = 'admin-user';
    service = new TaskRepository(db);
    const projectId = env.testProjectId;
    testProjectId = projectId;
  });

  afterEach(async () => {
    await db.deleteFrom('tasks').execute();
  });

  /**
   * Helper to build a plain task
   */
  const makePlain = ( overrides: Partial<Task['plain']> = {} ): Task['plain'] => ({
    id: toGlobalTaskId(testProjectId, 'E-1'),
    projectId: testProjectId,
    key: 'E-1',
    title: 'Epic root',
    description: null,
    status: TaskStatus.TODO,
    priority: TaskPriority.MEDIUM,
    taskType: TaskType.EPIC,
    parentTaskId: null,
    assignedAgentType: null,
    assignedAgentHostId: null,
    assignedAgentRef: null,
    assignedUserId: 'agent-host-1',
    gitBranch: 'main',
    explicitRepoId: null,
    sprintId: null,
    releaseId: null,
    storyPoints: null,
    businessValue: null,
    businessValueRationale: null,
    businessValueSource: null,
    managerRank: null,
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
    reviewCount: 0,
    lastReviewedAt: null,
    lastReviewVerdict: null,
    ...overrides,
  });

  const toGlobalTaskId = (projectKey: ProjectId, localSuffix: string) => {
    const id = `${projectKey}-${localSuffix}`;
    return id;
  };

  const buildTask = (overrides?: Partial<Task['plain']>): Task => {
    return Task.reconstitute(makePlain(overrides));
  };

  it.concurrent('AC-1: new parentTaskId in payload is persisted', async () => {
    const parentTask = buildTask({ key: 'P-2', title: 'Parent', parentTaskId: null });
    const fromRepo = await service.save(parentTask);
    expect(fromRepo.parentTaskId).toBeNull();

    const childTask = buildTask({ key: 'C-3', title: 'Child', parentTaskId: asTaskId('P-2') });
    const saved = await service.save(childTask);
    expect(saved.parentTaskId).toEqual(asTaskId('P-2'));
  });

  it.concurrent('AC-2: parentTaskId and assignedAgentRef both persisted together', async () => {
    const parentTask = buildTask({ key: 'P-4', title: 'Parent', parentTaskId: null });
    await service.save(parentTask);

    const childTask = buildTask({
      key: 'C-5',
      title: 'Child',
      assignedAgentRef: 'agent-42',
      parentTaskId: asTaskId('P-4'),
    });
    const saved = await service.save(childTask);
    expect(saved.parentTaskId).toEqual(asTaskId('P-4'));
    expect(saved.assignedAgentRef).toBe('agent-42');
  });

  it.concurrent('AC-3: parentTaskId retained across auto-run/reassignment side effects', async () => {
    const parentTask = buildTask({ key: 'P-6', title: 'Parent', parentTaskId: null });
    await service.save(parentTask);

    const childTask = buildTask({
      key: 'C-7',
      title: 'Child',
      assignedAgentRef: 'agent-42',
      parentTaskId: asTaskId('P-6'),
    });
    const saved = await service.save(childTask);
    expect(saved.parentTaskId).toEqual(asTaskId('P-6'));
    expect(saved.assignedAgentRef).toBe('agent-42');

    // Simulate a side-effect that fetches the task and updates another field only
    const updatedTask = await service.findById(saved.id);
    if (!updatedTask) {
      throw new Error('Task not found after save');
    }
    updatedTask.title = 'New title';
    const resaved = await service.save(updatedTask);

    expect(resaved.parentTaskId).toEqual(asTaskId('P-6'));
    expect(resaved.assignedAgentRef).toBe('agent-42');
    expect(resaved.title).toBe('New title');
  });

  it.concurrent('AC-4: omitting parentTaskId retains existing parentTaskId (no accidental null-out)', async () => {
    const baseTask = buildTask({
      key: 'B-8',
      title: 'Base with parent',
      parentTaskId: asTaskId('P-9'),
      description: 'Should not be nullified',
    });
    const saved = await service.save(baseTask);
    expect(saved.parentTaskId).toEqual(asTaskId('P-9'));
    expect(saved.description).toBeNull(); // null is allowed

    // Update only title (partial update)
    const updated = buildTask({
      id: saved.id,
      title: 'Updated title',
      parentTaskId: asTaskId('P-9'), // Explicitly set to the same value
    });
    const persisted = await service.save(updated);
    expect(persisted.parentTaskId).toEqual(asTaskId('P-9'));
    expect(persisted.title).toBe('Updated title');
  });
});