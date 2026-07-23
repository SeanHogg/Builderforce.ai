import { describe, expect, it } from 'vitest';
import { Task, type TaskProps } from './Task';
import {
  asProjectId, asTaskId, asAgentHostId,
  TaskPriority, TaskStatus, TaskType,
} from '../shared/types';

/**
 * Regression cover for #679 — "tasks.update drops parentTaskId when
 * assignedAgentRef is set in the same call".
 *
 * Callers build their patch as an object LITERAL with a key per updatable field, so
 * a field the caller did NOT touch still arrives as a present key holding
 * `undefined`. `TaskRepository.update` writes parent/assignee/sprint columns
 * authoritatively (`plain.x ?? null`) so an explicit `null` can clear them — which
 * turned that stray `undefined` into a real `NULL`. These lock the contract:
 * `undefined` = leave alone, `null` = clear.
 */
function taskFixture(over: Partial<TaskProps> = {}): Task {
  const now = new Date('2026-07-01T00:00:00.000Z');
  return Task.reconstitute({
    id: asTaskId(322),
    projectId: asProjectId(11),
    key: 'BF-322',
    title: 'Recommendations are specific, actionable, and linked to project data',
    description: null,
    status: TaskStatus.DONE,
    priority: TaskPriority.MEDIUM,
    taskType: TaskType.TASK,
    parentTaskId: asTaskId(152),
    assignedAgentType: null,
    githubIssueNumber: null,
    githubIssueUrl: null,
    githubPrUrl: null,
    githubPrNumber: null,
    assignedAgentHostId: asAgentHostId(7),
    assignedAgentRef: 'kevin-ba-pm-po',
    assignedUserId: 'user-sean',
    gitBranch: 'builderforce/task-322',
    explicitRepoId: 'repo-1',
    sprintId: 'sprint-1',
    releaseId: 'release-1',
    storyPoints: 3,
    businessValue: 45,
    businessValueRationale: 'Derived from medium priority.',
    businessValueSource: 'ai',
    managerRank: 210,
    reviewCount: 1,
    lastReviewedAt: now,
    lastReviewVerdict: 'gaps',
    gapOriginTaskId: null,
    startDate: null,
    dueDate: null,
    persona: null,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as TaskProps);
}

describe('Task.update — partial-edit semantics', () => {
  it('keeps parentTaskId when a patch only sets status + agent ref (#679)', () => {
    const updated = taskFixture().update({
      status: TaskStatus.IN_PROGRESS,
      assignedAgentRef: 'john-coder',
      // Every other updatable key arrives present-but-undefined, exactly as the
      // MCP `tasks.update` handler and TaskService build it.
      parentTaskId: undefined,
      assignedAgentHostId: undefined,
      assignedUserId: undefined,
      startDate: undefined,
      dueDate: undefined,
    });

    expect(updated.parentTaskId).toBe(152);
    expect(updated.status).toBe(TaskStatus.IN_PROGRESS);
    expect(updated.assignedAgentRef).toBe('john-coder');
  });

  it('leaves every untouched field alone on a single-field patch', () => {
    const before = taskFixture();
    const after = before.update({ title: 'Renamed' });

    expect(after.title).toBe('Renamed');
    expect(after.parentTaskId).toBe(before.parentTaskId);
    expect(after.assignedUserId).toBe(before.assignedUserId);
    expect(after.assignedAgentHostId).toBe(before.assignedAgentHostId);
    expect(after.sprintId).toBe(before.sprintId);
    expect(after.releaseId).toBe(before.releaseId);
    expect(after.storyPoints).toBe(before.storyPoints);
    expect(after.explicitRepoId).toBe(before.explicitRepoId);
  });

  it('still honours an explicit null as the authoritative clear', () => {
    const updated = taskFixture().update({
      parentTaskId: null,
      assignedUserId: null,
      sprintId: null,
      storyPoints: null,
    });

    expect(updated.parentTaskId).toBeNull();
    expect(updated.assignedUserId).toBeNull();
    expect(updated.sprintId).toBeNull();
    expect(updated.storyPoints).toBeNull();
  });

  it('bumps updatedAt even when the patch carries nothing but undefined', () => {
    const before = taskFixture();
    const after = before.update({ parentTaskId: undefined });

    expect(after.parentTaskId).toBe(before.parentTaskId);
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });
});
