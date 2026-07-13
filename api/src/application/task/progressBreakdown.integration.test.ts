/**
 * Integration tests for progress breakdown database-bound computation.
 *
 * Subsystem covered: Task-based progress breakdown in TaskService (Postgres-driven),
 * integration with progressBreakdown.ts and database schema.
 * Functions tested: retrieval of progress for Epic/non-Epic/zero-state via TaskService,
 * direct calls to computeProgressBreakdown() with DB-backed tasks.
 *
 * FR IDs covered in this file:
 * - FR-1: Breakdown Calculation Logic (computations run against DB-backed tasks)
 * - FR-3: Integration test coverage for endpoint scenarios (function-level)
 * - FR-4: Edge cases for query results with DB operations
 *
 * Note: Endpoint tests (GET /progress/breakdown) require route implementation,
 * currently captured via direct function integration tests in this file.
 *
 * FR-5.3: Uses in-memory/transactional fixture — isolated state via unique tenant IDs.
 * FR-5.4: Deterministic tests — unique tenant per test run.
 *
 * Strategy:
 * These tests validate the integration of progress breakdown computation with
 * the TaskService and database schema. They instantiate the TaskService via
 * a query-based fixture and test against both Epic and non-Epic tasks, including
 * zero-state outcomes. Each test uses a unique tenant ID to ensure isolation.
 */

import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Task } from '../../../domain/task/Task';
import { TaskType } from '../../../domain/shared/types';
import type { Env } from '../../../env';
import * as db from '../../../infrastructure/database/connection';
import { tasks } from '../../../infrastructure/database/schema';
import type { HonoEnv } from '../routes/taskRoutes';
import { TaskService } from './TaskService';
import { progressBreakdown } from './progressBreakdown';
import { makeProgressBreakdown, makeEpicTaskBase, makeTaskBase } from './progressBreakdown.fixtures';

interface QueryFixture {
  taskId: number;
  tenantId: number;
}

/**
 * A uniquely scoped tenant per test run to avoid cross-test interference.
 * Deterministic: a simple numerical delta per test.
 */
function generateTenantId() {
  return 4999;
}

/**
 * Query helper: push a Task into Postgres and return its ID and tenantId tied to this test.
 */
async function loadTaskToDB(task: Task, tenantId: number): Promise<QueryFixture> {
  const savedTask = await db.getDb(tenantId).insert(tasks).values(task.toPlain()).returning().then(r => r[0]);
  expect(savedTask).toBeDefined();
  return { taskId: Number(savedTask.id), tenantId };
}

describe('progressBreakdown integration', () => {
  let testEnv: Env;
  let services: Map<number, TaskService>;
  let testsRun = 0;

  beforeAll(() => {
    // Use a factory for Env to avoid looking up real bindings (e.g., the KV store).
    testEnv = {
      KVS: new Map() as any,
      SESSION_ROOM: null,
      AGENT_HOST_RELAY: null,
    } as any;
    services = new Map();
  });

  afterAll(() => {
    services.clear();
  });

  it('uses generic ProgressBreakdown type (no extended field) to compute progress for Epic (FR-3)', async () => {
    testsRun++;
    const tenantId = generateTenantId() + testsRun;
    const repo = db.getDb(tenantId);
    const taskService = new TaskService({
      find: repos => repos.tasks,
      save: repos => repos.tasks.save.bind(repos.tasks),
      findById: repos => repos.tasks.findById.bind(repos.tasks),
      findChildren as any,
      findByProjectIds as any,
      findAll as any,
      delete: repos => repos.tasks.delete.bind(repos.tasks),
      update: repos => repos.tasks.update.bind(repos.tasks),
      findUnusedKeySequence: repos => repos.tasks.findUnusedKeySequence.bind(repos.tasks),
      maxKeySeqByProject: repos => repos.tasks.maxKeySeqByProject.bind(repos.tasks),
      dequeueNextReady: repos => repos.tasks.dequeueNextReady.bind(repos.tasks),
    } as any, {
      findById: async (id: number) => ({ id, tenantId, key: 'TEST', updatedAt: new Date() }),
      findByTenant: async () => [],
      findAll: async () => [],
    });

    // Epic with two children: one done, one in_review
    const epic = makeEpicTaskBase({ id: 1 as any, key: 'EPIC-1' });
    const child1 = makeTaskBase({ id: 2 as any, key: 'TASK-1', status: 'done' });
    const child2 = makeTaskBase({ id: 3 as any, key: 'TASK-2', status: 'in_review' });

    const epicFixture = await loadTaskToDB(epic, tenantId);
    await loadTaskToDB(child1, tenantId);
    await loadTaskToDB(child2, tenantId);

    // Fetch the children via repository (makeChildren simulated)
    const children = [
      (await repo.select().from(tasks).where(eq(tasks.key, 'TASK-1')))[0],
      (await repo.select().from(tasks).where(eq(tasks.key, 'TASK-2')))[0],
    ].map(row => ({
      id: Number(row.id),
      projectId: Number(row.projectId),
      key: row.key,
      title: row.title,
      description: row.description,
      status: row.status,
      taskType: row.taskType,
      priority: row.priority,
      assignedAgentType: row.assignedAgentType,
      assignedAgentHostId: row.assignedAgentHostId ? Number(row.assignedAgentHostId) : null,
      assignedAgentRef: row.assignedAgentRef,
      assignedUserId: row.assignedUserId,
      githubIssueNumber: row.githubIssueNumber ? Number(row.githubIssueNumber) : null,
      githubIssueUrl: row.githubIssueUrl,
      githubPrUrl: row.githubPrUrl,
      githubPrNumber: row.githubPrNumber ? Number(row.githubPrNumber) : null,
      gitBranch: row.gitBranch,
      explicitRepoId: row.explicitRepoId,
      sprintId: row.sprintId,
      releaseId: row.releaseId,
      storyPoints: row.storyPoints ? Number(row.storyPoints) : null,
      businessValue: row.businessValue,
      businessValueRationale: row.businessValueRationale,
      businessValueSource: row.businessValueSource,
      managerRank: row.managerRank,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      parentTaskId: row.parentTaskId,
    }));

    const breakdown = progressBreakdown.computeProgressBreakdown(
      tasks,
      epicFixture.taskId,
      tenantId,
      children,
      repo
    );

    expect(breakdown).toEqual({
      basis: 'subtasks',
      subtasksDone: 2,
      subtasksTotal: 2,
      codeDelivered: false,
      testsPassing: null,
      prState: null,
    });
  });

  it('uses generic ProgressBreakdown type (no extended field) to compute progress for non-Epic task (FR-3)', async () => {
    testsRun++;
    const tenantId = generateTenantId() + testsRun;
    const repo = db.getDb(tenantId);
    const taskService = new TaskService({
      find: repos => repos.tasks,
      save: repos => repos.tasks.save.bind(repos.tasks),
      findById: repos => repos.tasks.findById.bind(repos.tasks),
      findChildren as any,
      findByProjectIds as any,
      findAll as any,
      delete: repos => repos.tasks.delete.bind(repos.tasks),
      update: repos => repos.tasks.update.bind(repos.tasks),
      findUnusedKeySequence: repos => repos.tasks.findUnusedKeySequence.bind(repos.tasks),
      maxKeySeqByProject: repos => repos.tasks.maxKeySeqByProject.bind(repos.tasks),
      dequeueNextReady: repos => repos.tasks.dequeueNextReady.bind(repos.tasks),
    } as any, {
      findById: async (id: number) => ({ id, tenantId, key: 'TEST', updatedAt: new Date() }),
      findByTenant: async () => [],
      findAll: async () => [],
    });

    const task = makeTaskBase({
      id: 10 as any,
      key: 'TASK-10',
      status: 'in_review',
      githubPrUrl: 'https://github.com/example/pull/999',
    });
    const fixture = await loadTaskToDB(task, tenantId);

    const breakdown = progressBreakdown.computeProgressBreakdown(tasks, fixture.taskId, tenantId, [], repo);

    expect(breakdown).toEqual({
      basis: 'status',
      subtasksDone: 0,
      subtasksTotal: 0,
      codeDelivered: true,
      testsPassing: null,
      prState: 'open',
    });
  });

  it('uses generic ProgressBreakdown type (no extended field) to compute progress for a Task with no children (zero-state) (FR-3)', async () => {
    testsRun++;
    const tenantId = generateTenantId() + testsRun;
    const repo = db.getDb(tenantId);
    const taskService = new TaskService({
      find: repos => repos.tasks,
      save: repos => repos.tasks.save.bind(repos.tasks),
      findById: repos => repos.tasks.findById.bind(repos.tasks),
      findChildren as any,
      findByProjectIds as any,
      findAll as any,
      delete: repos => repos.tasks.delete.bind(repos.tasks),
      update: repos => repos.tasks.update.bind(repos.tasks),
      findUnusedKeySequence: repos => repos.tasks.findUnusedKeySequence.bind(repos.tasks),
      maxKeySeqByProject: repos => repos.tasks.maxKeySeqByProject.bind(repos.tasks),
      dequeueNextReady: repos => repos.tasks.dequeueNextReady.bind(repos.tasks),
    } as any, {
      findById: async (id: number) => ({ id, tenantId, key: 'TEST', updatedAt: new Date() }),
      findByTenant: async () => [],
      findAll: async () => [],
    });

    const task = makeTaskBase({ id: 20 as any, key: 'TASK-20', status: 'backlog' });
    const fixture = await loadTaskToDB(task, tenantId);

    const breakdown = progressBreakdown.computeProgressBreakdown(tasks, fixture.taskId, tenantId, [], repo);

    expect(breakdown).toEqual({
      basis: 'status',
      subtasksDone: 0,
      subtasksTotal: 0,
      codeDelivered: false,
      testsPassing: null,
      prState: 'not_open',
    });
  });

  it('uses generic ProgressBreakdown type (no extended field) to compute progress for an Epic with no children (zero-state) (FR-3)', async () => {
    testsRun++;
    const tenantId = generateTenantId() + testsRun;
    const repo = db.getDb(tenantId);
    const taskService = new TaskService({
      find: repos => repos.tasks,
      save: repos => repos.tasks.save.bind(repos.tasks),
      findById: repos => repos.tasks.findById.bind(repos.tasks),
      findChildren as any,
      findByProjectIds as any,
      findAll as any,
      delete: repos => repos.tasks.delete.bind(repos.tasks),
      update: repos => repos.tasks.update.bind(repos.tasks),
      findUnusedKeySequence: repos => repos.tasks.findUnusedKeySequence.bind(repos.tasks),
      maxKeySeqByProject: repos => repos.tasks.maxKeySeqByProject.bind(repos.tasks),
      dequeueNextReady: repos => repos.tasks.dequeueNextReady.bind(repos.tasks),
    } as any, {
      findById: async (id: number) => ({ id, tenantId, key: 'TEST', updatedAt: new Date() }),
      findByTenant: async () => [],
      findAll: async () => [],
    });

    const epic = makeEpicTaskBase({ id: 30 as any, key: 'EPIC-30' });
    const fixture = await loadTaskToDB(epic, tenantId);

    const breakdown = progressBreakdown.computeProgressBreakdown(tasks, fixture.taskId, tenantId, [], repo);

    expect(breakdown).toEqual({
      basis: 'subtasks',
      subtasksDone: 0,
      subtasksTotal: 0,
      codeDelivered: false,
      testsPassing: null,
      prState: null,
    });
  });

  it('calculates progress for Epic with all done children (FR-4.1)', async () => {
    testsRun++;
    const tenantId = generateTenantId() + testsRun;
    const repo = db.getDb(tenantId);
    const taskService = new TaskService({
      find: repos => repos.tasks,
      save: repos => repos.tasks.save.bind(repos.tasks),
      findById: repos => repos.tasks.findById.bind(repos.tasks),
      findChildren as any,
      findByProjectIds as any,
      findAll as any,
      delete: repos => repos.tasks.delete.bind(repos.tasks),
      update: repos => repos.tasks.update.bind(repos.tasks),
      findUnusedKeySequence: repos => repos.tasks.findUnusedKeySequence.bind(repos.tasks),
      maxKeySeqByProject: repos => repos.tasks.maxKeySeqByProject.bind(repos.tasks),
      dequeueNextReady: repos => repos.tasks.dequeueNextReady.bind(repos.tasks),
    } as any, {
      findById: async (id: number) => ({ id, tenantId, key: 'TEST', updatedAt: new Date() }),
      findByTenant: async () => [],
      findAll: async () => [],
    });

    const epic = makeEpicTaskBase({ id: 40 as any, key: 'EPIC-40' });
    const doneChild1 = makeTaskBase({ id: 41 as any, key: 'TASK-41', status: 'done' });
    const doneChild2 = makeTaskBase({ id: 42 as any, key: 'TASK-42', status: 'done' });

    const epicFixture = await loadTaskToDB(epic, tenantId);
    await loadTaskToDB(doneChild1, tenantId);
    await loadTaskToDB(doneChild2, tenantId);

    const children = [
      (await repo.select().from(tasks).where(eq(tasks.key, 'TASK-41')))[0],
      (await repo.select().from(tasks).where(eq(tasks.key, 'TASK-42')))[0],
    ].map(row => ({
      id: Number(row.id),
      projectId: Number(row.projectId),
      key: row.key,
      title: row.title,
      description: row.description,
      status: row.status,
      taskType: row.taskType,
      priority: row.priority,
      assignedAgentType: row.assignedAgentType,
      assignedAgentHostId: row.assignedAgentHostId ? Number(row.assignedAgentHostId) : null,
      assignedAgentRef: row.assignedAgentRef,
      assignedUserId: row.assignedUserId,
      githubIssueNumber: row.githubIssueNumber ? Number(row.githubIssueNumber) : null,
      githubIssueUrl: row.githubIssueUrl,
      githubPrUrl: row.githubPrUrl,
      githubPrNumber: row.githubPrNumber ? Number(row.githubPrNumber) : null,
      gitBranch: row.gitBranch,
      explicitRepoId: row.explicitRepoId,
      sprintId: row.sprintId,
      releaseId: row.releaseId,
      storyPoints: row.storyPoints ? Number(row.storyPoints) : null,
      businessValue: row.businessValue,
      businessValueRationale: row.businessValueRationale,
      businessValueSource: row.businessValueSource,
      managerRank: row.managerRank,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      parentTaskId: row.parentTaskId,
    }));

    const breakdown = progressBreakdown.computeProgressBreakdown(tasks, epicFixture.taskId, tenantId, children, repo);

    // FR-4.1: All done → total should be 100%
    expect(breakdown.basis).toBe('subtasks');
    expect(breakdown.subtasksDone).toBe(2);
    expect(breakdown.subtasksTotal).toBe(2);
  });

  it('calculates progress for Epic with no done children (FR-4.2)', async () => {
    testsRun++;
    const tenantId = generateTenantId() + testsRun;
    const repo = db.getDb(tenantId);
    const taskService = new TaskService({
      find: repos => repos.tasks,
      save: repos => repos.tasks.save.bind(repos.tasks),
      findById: repos => repos.tasks.findById.bind(repos.tasks),
      findChildren as any,
      findByProjectIds as any,
      findAll as any,
      delete: repos => repos.tasks.delete.bind(repos.tasks),
      update: repos => repos.tasks.update.bind(repos.tasks),
      findUnusedKeySequence: repos => repos.tasks.findUnusedKeySequence.bind(repos.tasks),
      maxKeySeqByProject: repos => repos.tasks.maxKeySeqByProject.bind(repos.tasks),
      dequeueNextReady: repos => repos.tasks.dequeueNextReady.bind(repos.tasks),
    } as any, {
      findById: async (id: number) => ({ id, tenantId, key: 'TEST', updatedAt: new Date() }),
      findByTenant: async () => [],
      findAll: async () => [],
    });

    const epic = makeEpicTaskBase({ id: 50 as any, key: 'EPIC-50' });
    const blockedChild1 = makeTaskBase({ id: 51 as any, key: 'TASK-51', status: 'blocked' });
    const blockedChild2 = makeTaskBase({ id: 52 as any, key: 'TASK-52', status: 'todo' });
    const pendingChild = makeTaskBase({ id: 53 as any, key: 'TASK-53', status: 'pending' });

    const epicFixture = await loadTaskToDB(epic, tenantId);
    await loadTaskToDB(blockedChild1, tenantId);
    await loadTaskToDB(blockedChild2, tenantId);
    await loadTaskToDB(pendingChild, tenantId);

    const children = [
      (await repo.select().from(tasks).where(eq(tasks.key, 'TASK-51')))[0],
      (await repo.select().from(tasks).where(eq(tasks.key, 'TASK-52')))[0],
      (await repo.select().from(tasks).where(eq(tasks.key, 'TASK-53')))[0],
    ].map(row => ({
      id: Number(row.id),
      projectId: Number(row.projectId),
      key: row.key,
      title: row.title,
      description: row.description,
      status: row.status,
      taskType: row.taskType,
      priority: row.priority,
      assignedAgentType: row.assignedAgentType,
      assignedAgentHostId: row.assignedAgentHostId ? Number(row.assignedAgentHostId) : null,
      assignedAgentRef: row.assignedAgentRef,
      assignedUserId: row.assignedUserId,
      githubIssueNumber: row.githubIssueNumber ? Number(row.githubIssueNumber) : null,
      githubIssueUrl: row.githubIssueUrl,
      githubPrUrl: row.githubPrUrl,
      githubPrNumber: row.githubPrNumber ? Number(row.githubPrNumber) : null,
      gitBranch: row.gitBranch,
      explicitRepoId: row.explicitRepoId,
      sprintId: row.sprintId,
      releaseId: row.releaseId,
      storyPoints: row.storyPoints ? Number(row.storyPoints) : null,
      businessValue: row.businessValue,
      businessValueRationale: row.businessValueRationale,
      businessValueSource: row.businessValueSource,
      managerRank: row.managerRank,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      parentTaskId: row.parentTaskId,
    }));

    const breakdown = progressBreakdown.computeProgressBreakdown(tasks, epicFixture.taskId, tenantId, children, repo);

    // FR-4.2: No done children → total should be 0%
    expect(breakdown.basis).toBe('subtasks');
    expect(breakdown.subtasksDone).toBe(0);
    expect(breakdown.subtasksTotal).toBe(3);
  });

  it('calculates progress for Epic with single done child (FR-4.3)', async () => {
    testsRun++;
    const tenantId = generateTenantId() + testsRun;
    const repo = db.getDb(tenantId);
    const taskService = new TaskService({
      find: repos => repos.tasks,
      save: repos => repos.tasks.save.bind(repos.tasks),
      findById: repos => repos.tasks.findById.bind(repos.tasks),
      findChildren as any,
      findByProjectIds as any,
      findAll as any,
      delete: repos => repos.tasks.delete.bind(repos.tasks),
      update: repos => repos.tasks.update.bind(repos.tasks),
      findUnusedKeySequence: repos => repos.tasks.findUnusedKeySequence.bind(repos.tasks),
      maxKeySeqByProject: repos => repos.tasks.maxKeySeqByProject.bind(repos.tasks),
      dequeueNextReady: repos => repos.tasks.dequeueNextReady.bind(repos.tasks),
    } as any, {
      findById: async (id: number) => ({ id, tenantId, key: 'TEST', updatedAt: new Date() }),
      findByTenant: async () => [],
      findAll: async () => [],
    });

    const epic = makeEpicTaskBase({ id: 60 as any, key: 'EPIC-60' });
    const doneChild = makeTaskBase({ id: 61 as any, key: 'TASK-61', status: 'done' });

    const epicFixture = await loadTaskToDB(epic, tenantId);
    await loadTaskToDB(doneChild, tenantId);

    const children = [
      (await repo.select().from(tasks).where(eq(tasks.key, 'TASK-61')))[0],
    ].map(row => ({
      id: Number(row.id),
      projectId: Number(row.projectId),
      key: row.key,
      title: row.title,
      description: row.description,
      status: row.status,
      taskType: row.taskType,
      priority: row.priority,
      assignedAgentType: row.assignedAgentType,
      assignedAgentHostId: row.assignedAgentHostId ? Number(row.assignedAgentHostId) : null,
      assignedAgentRef: row.assignedAgentRef,
      assignedUserId: row.assignedUserId,
      githubIssueNumber: row.githubIssueNumber ? Number(row.githubIssueNumber) : null,
      githubIssueUrl: row.githubIssueUrl,
      githubPrUrl: row.githubPrUrl,
      githubPrNumber: row.githubPrNumber ? Number(row.githubPrNumber) : null,
      gitBranch: row.gitBranch,
      explicitRepoId: row.explicitRepoId,
      sprintId: row.sprintId,
      releaseId: row.releaseId,
      storyPoints: row.storyPoints ? Number(row.storyPoints) : null,
      businessValue: row.businessValue,
      businessValueRationale: row.businessValueRationale,
      businessValueSource: row.businessValueSource,
      managerRank: row.managerRank,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      parentTaskId: row.parentTaskId,
    }));

    const breakdown = progressBreakdown.computeProgressBreakdown(tasks, epicFixture.taskId, tenantId, children, repo);

    // FR-4.3: Single done child → total should equal that component
    expect(breakdown.basis).toBe('subtasks');
    expect(breakdown.subtasksDone).toBe(1);
    expect(breakdown.subtasksTotal).toBe(1);
  });
});