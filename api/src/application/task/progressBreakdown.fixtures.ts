/**
 * Test fixtures and factories for progress breakdown tests.
 *
 * Supports: FR-5.1 (builder for ProgressBreakdown), FR-5.2 (builder for SubComponent).
 *
 * This file is a companion to progressBreakdown.test.ts and may be imported by
 * integration tests that need reusable data constructs.
 */

import type { Task } from '../../domain/task/Task';
import { TaskType } from '../../domain/shared/types';
import { ProgressBreakdown } from '../../domain/task/ProgressBreakdown';

/**
 * Fr-5.1: Builder for ProgressBreakdown with sensible defaults.
 *
 * Accepts optional overrides to construct test data.
 */
export function makeProgressBreakdown(overrides: Partial<ProgressBreakdown> = {}): ProgressBreakdown {
  return {
    basis: 'subtasks',
    subtasksDone: 0,
    subtasksTotal: 2,
    codeDelivered: false,
    testsPassing: null,
    prState: null,
    ...overrides,
  };
}

/**
 * Fr-5.2: Builder for SubComponent objects for use in breakdown slices/params.
 *
 * (The current implementation doesn't expose SubComponent as a first-class type,
 * but this provides a consistent shape for hypothetical extensions/tests that may
 * depend on it in the future.)
 */
export interface SubComponent {
  id: string;
  label: string;
  value: number;
  weight: number;
  hidden?: boolean;
}

export function makeSubComponent(params: Partial<SubComponent> = {}): SubComponent {
  return {
    id: 'comp-1',
    label: 'Component A',
    value: 75,
    weight: 1,
    hidden: false,
    ...params,
  };
}

/**
 * Creates a mock Epic task with built-in defaults.
 *
 * This factory ensures that all tests start from the same baseline Epic
 * definition, reducing boilerplate.
 */
export function makeEpicTaskBase(overrides: Partial<Task> = {}): Task {
  const baseEpic = {
    id: 1 as any,
    projectId: 10 as any,
    key: 'EPIC-1',
    title: 'Epic',
    description: null,
    status: 'backlog',
    taskType: TaskType.EPIC,
    priority: 'medium',
    assignedAgentType: null,
    assignedAgentHostId: null,
    assignedAgentRef: null,
    assignedUserId: null,
    githubIssueNumber: null,
    githubIssueUrl: null,
    githubPrUrl: null,
    githubPrNumber: null,
    gitBranch: null,
    explicitRepoId: null,
    sprintId: null,
    releaseId: null,
    storyPoints: null,
    businessValue: null,
    businessValueRationale: null,
    businessValueSource: null,
    managerRank: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    parentTaskId: null,
  };

  // @ts-expect-error - test helper for Task creation
  const created = Task.create({ ...baseEpic });

  // Reconstitute to match Task runtime shape
  const plain = created.toPlain();
  const { reconstitute } = require('../../domain/task/Task');
  return reconstitute({
    ...plain,
    ...overrides,
  });
}

/**
 * Creates a mock TASK with built-in defaults.
 */
export function makeTaskBase(overrides: Partial<Task> = {}): Task {
  const baseTask = {
    id: 2 as any,
    projectId: 10 as any,
    key: 'TASK-1',
    title: 'Task',
    description: null,
    status: 'backlog',
    taskType: TaskType.TASK,
    priority: 'medium',
    assignedAgentType: null,
    assignedAgentHostId: null,
    assignedAgentRef: null,
    assignedUserId: null,
    githubIssueNumber: null,
    githubIssueUrl: null,
    githubPrUrl: null,
    githubPrNumber: null,
    gitBranch: null,
    explicitRepoId: null,
    sprintId: null,
    releaseId: null,
    storyPoints: null,
    businessValue: null,
    businessValueRationale: null,
    businessValueSource: null,
    managerRank: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    parentTaskId: null,
  };

  // @ts-expect-error - test helper for Task creation
  const created = Task.create({ ...baseTask });

  const plain = created.toPlain();
  const { reconstitute } = require('../../domain/task/Task');
  return reconstitute({
    ...plain,
    ...overrides,
  });
}

/**
 * Creates a set of child tasks with specified statuses.
 *
 * Useful for constructing test scenarios for Epic progress computation.
 */
export function makeChildrenSet(count: number, statuses: string[]): Task[] {
  return statuses.map((status, index) =>
    makeTaskBase({
      id: (2 + index) as any,
      status,
    })
  );
}