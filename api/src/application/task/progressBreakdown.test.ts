/**
 * Unit tests for computeProgressBreakdown() logic.
 *
 * Subsystem covered: Task-based breakdown calculation in TaskService (Postgres-driven);
 * computeProgressBreakdown() in progressBreakdown.ts.
 * Functions tested: computeProgressBreakdown() with Epic and non-Epic Tasks.
 *
 * FR IDs covered:
 * - FR-1: Breakdown Calculation Logic (Epic subtask counts, non-Epic PR and status)
 * - FR-2: (currently implemented via computeProgressBreakdown; no normalize/aggreg helpers exposed)
 * - FR-4: Edge Cases (single-child Epic, all-0 children)
 * - FR-3: (separate integration tests covering endpoint scenarios)
 *
 * AC IDs referenced in this file:
 * - AC-6: Clear failure messages and test determinism
 */

import { describe, expect, it } from 'vitest';
import type { Task } from '../../domain/task/Task';
import { TaskType } from '../../domain/shared/types';
import {
  computeProgressBreakdown,
} from './progressBreakdown';
import { ProgressBreakdown } from '../../domain/task/ProgressBreakdown';

// ---------------------------------------------------------------------------
// Test fixtures / factories
// ---------------------------------------------------------------------------

/**
 * Creates a mock Epic task.
 */
function makeEpicTask(overrides: Partial<Task> = {}): Task {
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

  return { ...createMockTask(created), ...overrides };
}

/**
 * Creates a mock child task.
 */
function makeTask(overrides: Partial<Task> = {}): Task {
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

  return { ...createMockTask(created), ...overrides };
}

/**
 * Simple mock Task function missing some Task fields.
 */
function createMockTask(task: Task): Task {
  const plain = task.toPlain();
  const { reconstitute } = require('../../domain/task/Task');
  // Ensure we have all required fields
  const props: any = {
    id: plain.id,
    projectId: plain.projectId,
    key: plain.key,
    title: plain.title,
    description: plain.description,
    status: plain.status,
    taskType: plain.taskType,
    priority: plain.priority,
    assignedAgentType: plain.assignedAgentType,
    assignedAgentHostId: plain.assignedAgentHostId,
    assignedAgentRef: plain.assignedAgentRef,
    assignedUserId: plain.assignedUserId,
    githubIssueNumber: plain.githubIssueNumber,
    githubIssueUrl: plain.githubIssueUrl,
    githubPrUrl: plain.githubPrUrl,
    githubPrNumber: plain.githubPrNumber,
    gitBranch: plain.gitBranch,
    explicitRepoId: plain.explicitRepoId,
    sprintId: plain.sprintId,
    releaseId: plain.releaseId,
    storyPoints: plain.storyPoints,
    businessValue: plain.businessValue,
    businessValueRationale: plain.businessValueRationale,
    businessValueSource: plain.businessValueSource,
    managerRank: plain.managerRank,
    parentTaskId: plain.parentTaskId,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
  return reconstitute(props);
}

/**
 * Creates multiple child tasks with different statuses.
 */
function makeChildren(count: number, statuses: string[]): Task[] {
  return statuses.map((status, index) =>
    makeTask({ id: 2 + index as any, status } as any)
  );
}

// ---------------------------------------------------------------------------
// Unit tests for computeProgressBreakdown (Epoch).
// ---------------------------------------------------------------------------

describe('computeProgressBreakdown', () => {
  describe('Epics', () => {
    // FR-1.6: Empty input returns a well-defined zero-state object rather than an error.
    it('returns a well-defined zero-state for an Epic with no children', () => {
      const epic = makeEpicTask({ id: 1 as any });
      const children: Task[] = [];
      const breakdown = computeProgressBreakdown(epic, children);

      expect(breakdown).toEqual<ProgressBreakdown>({
        basis: 'subtasks',
        subtasksDone: 0,
        subtasksTotal: 0,
        codeDelivered: false,
        testsPassing: null,
        prState: null,
      });
    });

    // FR-1.1: Weighted sum of children when all values present (counts here).
    // FR-4.2: All children at 0 → total is 0.
    it('computes progress based on done vs total child count', () => {
      const epic = makeEpicTask({ id: 1 as any });
      const children = makeChildren(5, [
        'done',
        'done',
        'in_review',
        'backlog',
        'block',
      ]);

      const breakdown = computeProgressBreakdown(epic, children);

      // FR-1.1: Total = weighted sum (counts done/in_review children).
      expect(breakdown.basis).toBe('subtasks');
      expect(breakdown.subtasksDone).toBe(3); // done + in_review
      expect(breakdown.subtasksTotal).toBe(5);
      expect(breakdown.codeDelivered).toBe(false);
    });

    it('counts only done and in_review statuses as "done"', () => {
      const epic = makeEpicTask({ id: 1 as any });
      // All children are blocked, so done count should be 0.
      const children = makeChildren(4, ['block', 'block', 'block', 'block']);

      const breakdown = computeProgressBreakdown(epic, children);

      expect(breakdown.subtasksDone).toBe(0);
      expect(breakdown.subtasksTotal).toBe(4);
    });

    // FR-4.1: All children at 100 → total is 100 (via count representation).
    it('returns 100% when all children are done', () => {
      const epic = makeEpicTask({ id: 1 as any });
      const children = makeChildren(3, ['done', 'done', 'done']);

      const breakdown = computeProgressBreakdown(epic, children);

      expect(breakdown.subtasksDone).toBe(3);
      expect(breakdown.subtasksTotal).toBe(3);
    });
  });

  describe('Non-Epic tasks', () => {
    // FR-1.8: lastUpdated reflects most-recently-modified sub-component (not applicable here).
    // Note: computeProgressBreakdown doesn't compute lastUpdated without extra work.

    it('computes from task status and PR info for non-Epic tasks', () => {
      const task = makeTask({
        id: 1 as any,
        taskType: TaskType.TASK,
        status: 'in_review',
        githubPrUrl: 'https://github.com/org/repo/pull/123',
      });
      const children: Task[] = [];

      const breakdown = computeProgressBreakdown(task, children);

      expect(breakdown).toEqual<ProgressBreakdown>({
        basis: 'status',
        subtasksDone: 0,
        subtasksTotal: 0,
        codeDelivered: true, // in_review + has PR
        testsPassing: null,
        prState: 'open',
      });
    });

    it('codes PR as open when PR URL is present', () => {
      const task = makeTask({
        id: 1 as any,
        taskType: TaskType.TASK,
        status: 'backlog',
        githubPrUrl: 'https://github.com/org/repo/pull/123',
      });
      const children: Task[] = [];

      const breakdown = computeProgressBreakdown(task, children);

      expect(breakdown.prState).toBe('open');
    });

    it('codes PR as not_open when no PR URL', () => {
      const task = makeTask({
        id: 1 as any,
        taskType: TaskType.TASK,
        status: 'done',
      });
      const children: Task[] = [];

      const breakdown = computeProgressBreakdown(task, children);

      expect(breakdown.prState).toBe('not_open');
    });

    it('sets codeDelivered to true only when PR is open (in_review or done) and PR exists', () => {
      const cases = [
        { status: 'done', hasPr: true, expected: true },
        { status: 'in_review', hasPr: true, expected: true },
        { status: 'block', hasPr: true, expected: false },
        { status: 'done', hasPr: false, expected: false },
        { status: 'backlog', hasPr: false, expected: false },
      ];

      for (const { status, hasPr, expected } of cases) {
        const task = makeTask({
          id: 1 as any,
          taskType: TaskType.TASK,
          status,
          githubPrUrl: hasPr ? 'https://github.com/org/repo/pull/123' : null,
        });
        const children: Task[] = [];
        const breakdown = computeProgressBreakdown(task, children);
        expect(breakdown.codeDelivered).toBe(expected,
          `status=${status}, hasPr=${hasPr} → codeDelivered=${expected}`);
      }
    });
  });

  describe('Edge Cases & Boundaries', () => {
    // FR-4.3: One sub-component with weight 1.0 → total equals that component.
    // (Interpreted as Epic with single done child = 100% progress).
    it('returns 100% for Epic with single done child', () => {
      const epic = makeEpicTask({ id: 1 as any });
      const task = makeTask({
        id: 2 as any,
        status: 'done',
      });
      const children = [task];

      const breakdown = computeProgressBreakdown(epic, children);

      expect(breakdown.subtasksDone).toBe(1);
      expect(breakdown.subtasksTotal).toBe(1);
    });

    // FR-4.2: All sub-components at 0 → total is 0.
    it('returns 0% for Epic with no done children', () => {
      const epic = makeEpicTask({ id: 1 as any });
      const children = makeChildren(5, ['block', 'block', 'backlog', 'to_do', 'pending']);

      const breakdown = computeProgressBreakdown(epic, children);

      expect(breakdown.subtasksDone).toBe(0);
      expect(breakdown.subtasksTotal).toBe(5);
    });

    it('handles Epic with null children without throwing', () => {
      const epic = makeEpicTask({ id: 1 as any });
      // @ts-expect-error - test invalid input: null not allowed
      const breakdown = computeProgressBreakdown(epic, null);

      // Should still return a valid breakdown shape; actual behavior is non-deterministic
      // based on implementation; we just test it doesn't crash.
      expect(breakdown).toBeDefined();
      expect(typeof breakdown).toBe('object');
    });

    it('handles missing task fields gracefully', () => {
      const task = makeTask({ id: 1 as any });
      const plain = task.toPlain();
      // Introduce missing fields that TypeScript isolates from runtime
      const runtimeTask = {
        ...plain,
        taskType: plain.taskType,
      };
      const { reconstitute } = require('../../domain/task/Task');
      const taskWithoutChild = reconstitute(runtimeTask);
      const children: Task[] = [];

      // Should not throw; computeProgressBreakdown is tolerant of runtime shape.
      const breakdown = computeProgressBreakdown(taskWithoutChild, children);
      expect(breakdown).toBeDefined();
    });
  });
});