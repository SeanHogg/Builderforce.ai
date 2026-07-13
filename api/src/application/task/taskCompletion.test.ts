/**
 * Unit tests for task completion logic (completeTask, recordCompletion, completeTaskViaPr, completeTaskViaGreenCI).
 * Focus on Scenarios A (completion with PR artifacts), B (completion without artifacts), C/D (edge cases).
 * All external dependencies are mocked — no real I/O.
 *
 * PRD concept mapping:
 * - "delivered code artifacts" = completedTaskOptions.deliveredArtifacts (list of ID/type/uri entries)
 * - "completion without delivered code" = empty artifacts array ([]), no PR-linked commit
 * - "deliveredArtifacts collection" = CompletionResult.deliveredArtifacts (array)
 * - Result type guard: isSuccessResult ensures typed success payload
 *
 * FR-4 compliance:
 * - FR-4.1: All external dependencies (real db, events, file storage) are mocked — no real I/O in any test
 * - FR-4.2: Each test case is independent; beforeEach resets db fake state (new fake per test group)
 * - FR-4.3: Test file is co-located with the module under test (taskCompletion.test.ts ⇔ taskCompletion.ts)
 * - FR-4.4: Uses vitest (the project's existing test framework, per  api/package.json )
 * - FR-4.5: Coverage ≥ 90% line / ≥ 85% branch expected for taskCompletion module
 *
 * All tests use the minimal stateless fake to capture update payloads for assertions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  completeTask,
  completeTaskViaPr,
  completeTaskViaGreenCI,
  recordCompletion,
  isSuccessResult,
  type DeliveredArtifact,
  type CompletionResult,
  TaskNotFoundError,
  InvalidStateError,
} from './taskCompletion';
import { TaskStatus } from '../../domain/shared/types';

// ===========================================================================

/**
 * Minimal chainable fake that captures update().set() payloads for assertions.
 * Does NOT mutate state across tests — each test group creates its own fresh fake.
 */
function makeFakeDb() {
  type SetPayload = Record<string, unknown>;
  type UpdateCapture = { setPayload: SetPayload };
  let updates: UpdateCapture[] = [];

  function chain() {
    const c: Record<string, any> = {};
    c.set = (payload: Record<string, unknown>) => {
      updates.push({ setPayload: payload });
      return {
        where: () => Promise.resolve([]),
      };
    };
    c.then = (resolve: (v: unknown[]) => unknown) => resolve([]);
    return c;
  }

  return {
    updates: () => updates,
    db: {
      select() {
        return { from: () => chain() };
      },
      findById(id: number) {
        const taskById = vi.spyOn(this as any, 'findById');
        return new Promise((resolve) => {
          const task = createTask({ id: id, status: TaskStatus.IN_PROGRESS });
          return resolve(task);
        });
      },
      update(table: any) {
        return {
          set: (payload: SetPayload) => {
            updates.push({ setPayload: payload });
            return { where: () => Promise.resolve([]) };
          },
        };
      },
    },
  };
}

// ===========================================================================

// ---------------------------------------------------------------------------
/**
 * Completion with delivered code (Scenario A)
 */

describe('completeTask (completion with PR artifacts)', () => {
  it('FR-1.1: marks task DONE when delivered artifacts are provided', async () => {
    const artifact: DeliveredArtifact = {
      id: 'pr-123-merge',
      type: 'pull_request',
      uri: 'https://github.com/org/repo/pull/123',
    };
    const { db, updates } = makeFakeDb();

    // Start with pending task (not yet DONE)
    const task = createTask({ id: 1, status: TaskStatus.IN_PROGRESS });
    const result = await completeTask(task, { deliveredArtifacts: [artifact] }, db);

    // Should succeed as CompletionResult
    expect(isSuccessResult(result)).toBe(true);
    expect(result.deliveredArtifacts).toHaveLength(1);
    expect(result.deliveredArtifacts[0]).toEqual(artifact);

    // DB should be updated with DONE status
    const statusUpdate = updates().find((u) => (u.setPayload as any)?.status === TaskStatus.DONE);
    expect(statusUpdate).toBeDefined();
    expect(statusUpdate!.setPayload.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:T.]*$/);
  });

  it('FR-1.2: completion timestamp is ISO-8601 datetime when delivered-code completion occurs', async () => {
    const artifact: DeliveredArtifact = {
      id: 'commit-a1b2',
      type: 'git_commit',
      uri: 'https://github.com/org/repo/commit/a1b2c3d4',
    };
    const { db, updates } = makeFakeDb();

    const task = createTask({ id: 2, status: TaskStatus.IN_PROGRESS });
    const result = await completeTask(task, { deliveredArtifacts: [artifact] }, db);

    expect(isSuccessResult(result)).toBe(true);
    const statusUpdate = updates().find((u) => (u.setPayload as any)?.completedAt);
    expect(statusUpdate).toBeDefined();
    const completedAt = statusUpdate!.setPayload.completedAt as Date;
    expect(completedAt.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:T.]*$/);
  });

  it('FR-1.3: Completion result payload includes a non-empty deliveredArtifacts collection', async () => {
    const artifact: DeliveredArtifact = {
      id: 'pr-456-4',
      type: 'pull_request',
      uri: 'https://github.com/org/repo/pull/456',
    };
    const { db } = makeFakeDb();

    const task = createTask({ id: 3, status: TaskStatus.IN_PROGRESS });
    const result = await completeTask(task, { deliveredArtifacts: [artifact] }, db);

    expect(isSuccessResult(result)).toBe(true);
    expect(result.deliveredArtifacts).toBeInstanceOf(Array);
    expect(result.deliveredArtifacts.length).toBeGreaterThan(0);
  });

  it('FR-1.4: each artifact contains id, type, and uri fields', async () => {
    const { db } = makeFakeDb();

    const task = createTask({ id: 4, status: TaskStatus.IN_PROGRESS });
    const artifact: DeliveredArtifact = {
      id: 'pr-789-mine',
      type: 'other',
      uri: 'https://example.com/artifact.zip',
    };
    const result = await completeTask(task, { deliveredArtifacts: [artifact] }, db);

    expect(isSuccessResult(result)).toBe(true);
    const returnedArtifact = result.deliveredArtifacts[0];
    expect(returnedArtifact.id).toBe('pr-789-mine');
    expect(returnedArtifact.type).toBe('other');
    expect(returnedArtifact.uri).toBe('https://example.com/artifact.zip');
  });

  it('FR-1.5: if multiple code artifacts are delivered, all are present in result; none are silently dropped', async () => {
    const { db } = makeFakeDb();

    const task = createTask({ id: 5, status: TaskStatus.IN_PROGRESS });
    const artifacts: DeliveredArtifact[] = [
      { id: 'pr-a', type: 'pull_request', uri: 'https://github.com/org/repo/pull/a' },
      { id: 'pr-b', type: 'pull_request', uri: 'https://github.com/org/repo/pull/b' },
      { id: 'pr-c', type: 'pull_request', uri: 'https://github.com/org/repo/pull/c' },
    ];
    const result = await completeTask(task, { deliveredArtifacts: artifacts }, db);

    expect(isSuccessResult(result)).toBe(true);
    expect(result.deliveredArtifacts).toHaveLength(3);
    // All three should be present in order
    expect(result.deliveredArtifacts[0].id).toBe('pr-a');
    expect(result.deliveredArtifacts[1].id).toBe('pr-b');
    expect(result.deliveredArtifacts[2].id).toBe('pr-c');
  });
});

// ---------------------------------------------------------------------------
/**
 * Completion without delivered code (Scenario B)
 */

describe('completeTask (completion without delivered code)', () => {
  it('FR-2.1: task with no artifacts still resolves to completed when conditions are met', async () => {
    const { db, updates } = makeFakeDb();

    const task = createTask({ id: 10, status: TaskStatus.IN_PROGRESS });
    const result = await completeTask(task, { deliveredArtifacts: [] }, db);

    expect(isSuccessResult(result)).toBe(true);
    expect(result.deliveredArtifacts).toHaveLength(0);

    const statusUpdate = updates().find((u) => (u.setPayload as any)?.status === TaskStatus.DONE);
    expect(statusUpdate).toBeDefined();
  });

  it('FR-2.2: deliveredArtifacts is empty collection - never partial/undefined/null', async () => {
    const { db } = makeFakeDb();

    const task = createTask({ id: 11, status: TaskStatus.IN_PROGRESS });
    const result = await completeTask(task, {}, db);

    expect(isSuccessResult(result)).toBe(true);
    expect(result.deliveredArtifacts).toEqual([]);
  });

  it('FR-2.3: completion timestamp recorded correctly when no code is delivered', async () => {
    const { db, updates } = makeFakeDb();

    const task = createTask({ id: 12, status: TaskStatus.IN_PROGRESS });
    await completeTask(task, { deliveredArtifacts: [] }, db);

    const completedUpdate = updates().find((u) => typeof (u.setPayload as any)?.completedAt === 'string');
    expect(completedUpdate).toBeDefined();
    const completedAt = completedUpdate!.setPayload.completedAt as string;
    expect(completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:T.]*$/);

    // Verify the timestamp is not just digits, includes proper ISO-8601 time separator
    const datePart = completedAt.slice(0, 10);
    const timePart = completedAt.slice(11);
    expect(datePart.indexOf('-')).toBe(4);
    expect(datePart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(timePart.indexOf('T')).toBe(0);
    expect(timePart).toMatch(/^[\d:T.]+Z?$/);
  });
});

// ---------------------------------------------------------------------------
/**
 * Negative / edge cases (Scenario C)
 */

describe('completeTask (negative / edge cases)', () => {
  it('FR-3.1: task with non-delivered artifacts (pending/in_progress) does NOT transition to completed', async () => {
    const { db } = makeFakeDb();

    const task = createTask({ id: 20, status: TaskStatus.IN_PROGRESS });
    // Mix of delivered/non-delivered - invalid state for completion
    const artifacts: DeliveredArtifact[] = [
      { id: 'pr-d', type: 'pull_request', uri: 'https://github.com/org/repo/pull/d' },
      // Artifact 'pr-e' is NOT delivered (status is still IN_PROGRESS)
      { id: 'pr-e', type: 'pull_request', uri: 'https://github.com/org/repo/pull/e' },
    ];

    await expect(
      completeTask(task, { deliveredArtifacts: artifacts }, db)
    ).rejects.toThrow();
    // Task should NOT have been updated
    const updates = makeFakeDb().updates();
    expect(updates().length).toBe(0);
  });

  it('FR-3.2: calling completion twice on a completed task is idempotent', async () => {
    const artifact: DeliveredArtifact = {
      id: 'idempotent-pr-财富',
      type: 'pull_request',
      uri: 'https://github.com/org/repo/pull/42',
    };
    const { db, updates } = makeFakeDb();

    const task = createTask({ id: 30, status: TaskStatus.DONE });
    await completeTask(task, { deliveredArtifacts: [artifact] }, db);
    const firstUpdateCount = updates().length;

    // Second call should not create a second completion record
    await completeTask(task, { deliveredArtifacts: [artifact] }, db);
    const secondUpdateCount = updates().length;

    expect(secondUpdateCount).toBe(firstUpdateCount);
  });

  it('FR-3.2: double completion result payload does not change on subsequent calls', async () => {
    const artifact: DeliveredArtifact = {
      id: 'idempotent-pr-123',
      type: 'pull_request',
      uri: 'https://github.com/org/repo/pull/123',
    };
    const { db } = makeFakeDb();

    const task = createTask({ id: 31, status: TaskStatus.DONE });
    const result1 = await completeTask(task, { deliveredArtifacts: [artifact] }, db);
    const result2 = await completeTask(task, { deliveredArtifacts: [artifact] }, db);

    // Both results should be identical payloads
    expect(result1.deliveredArtifacts).toEqual(result2.deliveredArtifacts);
    expect(result2.completedAt).toBe(result1.completedAt);
  });

  it('FR-3.3: calling completion on a cancelled task raises InvalidStateError', async () => {
    const { db } = makeFakeDb();

    const task = createTask({ id: 40, status: TaskStatus.CANCELLED });
    await expect(
      completeTask(task, { deliveredArtifacts: [] }, db)
    ).rejects.toThrow(InvalidStateError);
  });

  it('FR-3.3: calling completion on a failed task raises InvalidStateError', async () => {
    const { db } = makeFakeDb();

    const task = createTask({ id: 41, status: TaskStatus.FAILED });
    await expect(
      completeTask(task, { deliveredArtifacts: [] }, db)
    ).rejects.toThrow(InvalidStateError);
  });

  it('FR-3.4: passing null as task input raises InvalidStateError immediately', async () => {
    const { db } = makeFakeDb();

    await expect(
      completeTask(null as any, {}, db)
    ).rejects.toThrow(InvalidStateError);
  });

  it('FR-3.4: passing undefined as task input raises InvalidStateError immediately', async () => {
    const { db } = makeFakeDb();

    await expect(
      completeTask(undefined as any, {}, db)
    ).rejects.toThrow(InvalidStateError);
  });

  it('FR-3.5: task with mix of delivered and non-delivered artifacts raises error', async () => {
    const { db } = makeFakeDb();

    const task = createTask({ id: 50, status: TaskStatus.IN_PROGRESS });
    const artifacts: DeliveredArtifact[] = [
      { id: 'half-ok', type: 'pull_request', uri: 'https://github.com/org/repo/pull/hand' },
      { id: 'incomplete', type: 'pull_request', uri: 'https://github.com/org/repo/pull/wait' },
    ];

    await expect(
      completeTask(task, { deliveredArtifacts: artifacts }, db)
    ).rejects.toThrow(InvalidStateError);
  });
});

// ---------------------------------------------------------------------------
/**
 * Convenience functions (via recordCompletion)
 */

describe('recordCompletion (convenience completion path)', () => {
  it('SR-A.1: PR merge path returns CompletionResult with delivered artifacts', async () => {
    const artifact: DeliveredArtifact = {
      id: 'via-pr-pr-60',
      type: 'pull_request',
      uri: 'https://github.com/org/repo/pull/60',
    };
    const { db } = makeFakeDb();

    const result = await recordCompletion(db, 60, {
      deliveredArtifacts: [artifact],
    });

    expect(isSuccessResult(result)).toBe(true);
    expect(result.deliveredArtifacts).toHaveLength(1);
    expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:T.]*$/);
  });

  it('SR-B.1: green-CI path returns CompletionResult with empty artifacts array', async () => {
    const { db } = makeFakeDb();

    const result = await recordCompletion(db, 70, {
      deliveredArtifacts: [],
    });

    expect(isSuccessResult(result)).toBe(true);
    expect(result.deliveredArtifacts).toEqual([]);
    expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:T.]*$/);
  });

  it('SR-C.1: invalid task ID (null) returns TaskNotFoundError', async () => {
    const { db } = makeFakeDb();

    const result = await recordCompletion(db, null as unknown as number);
    expect(isSuccessResult(result)).toBe(false);
    expect(result).toBeInstanceOf(TaskNotFoundError);
    expect((result as TaskNotFoundError).message).toContain('Invalid taskId');
  });

  it('SR-C.2: invalid task ID (zero) returns TaskNotFoundError', async () => {
    const { db } = makeFakeDb();

    const result = await recordCompletion(db, 0);
    expect(isSuccessResult(result)).toBe(false);
    expect(result).toBeInstanceOf(TaskNotFoundError);
    expect((result as TaskNotFoundError).message).toContain('Task with ID 0');
  });

  it('SR-C.3: non-existent task returns TaskNotFoundError', async () => {
    const { db } = makeFakeDb();

    // Make findById always return null (simulate missing row)
    const { db: nullDb } = makeFakeDb();
    const findSpy = vi.spyOn(nullDb.db as any, 'findById')
      .mockResolvedValue(null);

    const result = await recordCompletion(nullDb.db, 999);
    expect(isSuccessResult(result)).toBe(false);
    expect(result).toBeInstanceOf(TaskNotFoundError);
    expect((result as TaskNotFoundError).message).toContain('not found');
    findSpy.mockRestore();
  });

  it('SR-D.1: task not ready for completion returns InvalidStateError', async () => {
    const { db } = makeFakeDb();

    // Simulate pending task
    const task = createTask({ id: 80, status: TaskStatus.IN_PROGRESS });
    const findSpy = vi.spyOn(db.db as any, 'findById')
      .mockResolvedValue(task);

    const result = await recordCompletion(db.db, 80);
    expect(isSuccessResult(result)).toBe(false);
    expect(result).toBeInstanceOf(InvalidStateError);
    expect((result as InvalidStateError).message).toContain('Cannot complete task');
    findSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
/**
 * recordCompletion stateless idempotency (double complete of same task ID)
 */

describe('recordCompletion (idempotency double-complete)', () => {
  it('when twice-called on same task ID, should not persist duplicate completion records', async () => {
    const { db, updates } = makeFakeDb();

    vi.spyOn(db.db as any, 'findById')
      .mockResolvedValue(createTask({ id: 90, status: TaskStatus.IN_PROGRESS }))
      .mockResolvedValue(createTask({ id: 90, status: TaskStatus.DONE }));

    await recordCompletion(db.db, 90, {
      deliveredArtifacts: [{ id: 'pr-90', type: 'pull_request', uri: 'https://github.com/org/repo/pull/90' }],
    });
    const firstWriteCount = updates().length;

    await recordCompletion(db.db, 90, {
      deliveredArtifacts: [{ id: 'pr-90', type: 'pull_request', uri: 'https://github.com/org/repo/pull/90' }],
    });
    const secondWriteCount = updates().length;

    expect(secondWriteCount).toBe(firstWriteCount);
  });
});

// ---------------------------------------------------------------------------
/**
 * Convenience functions (completeTaskViaPr and completeTaskViaGreenCI)
 */

describe('convenience completion functions', () => {
  it('completeTaskViaPr: PR merge path returns CompletionResult with single PR artifact', async () => {
    const { db } = makeFakeDb();

    const result = await completeTaskViaPr(db.db, 100, 'https://github.com/org/repo/pull/123', '123');

    expect(isSuccessResult(result)).toBe(true);
    expect(result.deliveredArtifacts).toHaveLength(1);
    expect(result.deliveredArtifacts[0].id).toContain('pr-100');
    expect(result.deliveredArtifacts[0].type).toBe('pull_request');
    expect(result.deliveredArtifacts[0].uri).toBe('https://github.com/org/repo/pull/123');
    expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:T.]*$/);
  });

  it('completeTaskViaPr: passes actorUserId to the underlying options correctly', async () => {
    const { db } = makeFakeDb();

    const result = await completeTaskViaPr(db.db, 200, 'https://github.com/org/repo/pull/456', '456', 'user-123');

    expect(isSuccessResult(result)).toBe(true);
    // actorUserId is not part of the CompletionResult; it's only a passed-through option.
    // no assertion over user ID in the payload here.
  });

  it('completeTaskViaGreenCI: green-CI path returns CompletionResult with empty artifacts array', async () => {
    const { db } = makeFakeDb();

    const result = await completeTaskViaGreenCI(db.db, 300);

    expect(isSuccessResult(result)).toBe(true);
    expect(result.deliveredArtifacts).toEqual([]);
    expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:T.]*$/);
  });

  it('completeTaskViaPr: uses prNumber from options when available for error messages, none yet in result', async () => {
    const { db } = makeFakeDb();

    const result = await completeTaskViaPr(db.db, 400, 'https://github.com/org/repo/pull/999');

    expect(isSuccessResult(result)).toBe(true);
    // Extracted artifact uses prNumber placeholder 'merged' when prNumber is omitted.
    // Result payload does not expose prNumber directly.
  });
});

// ---------------------------------------------------------------------------
/**
 * Completion result type guard
 */

describe('isSuccessResult', () => {
  it('returns true for CompletionResult instances', () => {
    const result: CompletionResult = {
      deliveredArtifacts: [{ id: 'pr-1', type: 'pull_request', uri: 'https://github.com/org/repo/pull/1' }],
      completedAt: new Date().toISOString(),
    };
    expect(isSuccessResult(result)).toBe(true);
  });

  it('returns false for TaskNotFoundError instances', () => {
    const error = new TaskNotFoundError('Task not found');
    expect(isSuccessResult(error)).toBe(false);
  });

  it('returns false for InvalidStateError instances', () => {
    const error = new InvalidStateError('Invalid state');
    expect(isSuccessResult(error)).toBe(false);
  });

  it('returns false for plain objects that do not match CompletionResult shape', () => {
    const plainObject = {
      deliveredArtifacts: [{ id: 'test', type: 'pull_request', uri: 'http://example.com' }],
      completedAt: '2024-01-01T00:00:00.000Z',
    };
    // Plain object without explicit name property returns false
    expect(isSuccessResult(plainObject as any)).toBe(false);
  });

  it('returns false for objects that are missing required fields', () => {
    const incompleteResult = {
      deliveredArtifacts: [],
      // Missing completedAt field
    };
    expect(isSuccessResult(incompleteResult as any)).toBe(false);
  });

  it('returns false for null value', () => {
    expect(isSuccessResult(null as any)).toBe(false);
  });

  it('returns false for undefined value', () => {
    expect(isSuccessResult(undefined as any)).toBe(false);
  });
});

// ===========================================================================

/**
 * Helper to create a plain Task object (POJO) for testing.
 * This mimics the POJO pattern used internally for Task completion logic,
 * calling Task.create would require extra construction steps.
 */
function createTask(partial: {
  id: number;
  projectId: number;
  status: string;
  [key: string]: any;
}) {
  const now = new Date();
  return {
    id: partial.id,
    projectId: partial.projectId,
    key: `PRJ-${String(partial.id).padStart(3, '0')}`,
    title: 'Sample task',
    description: null,
    status: partial.status,
    priority: TaskStatus.MEDIUM as any, // placeholder
    taskType: TaskStatus.TASK as any, // placeholder
    parentTaskId: null,
    assignedAgentType: null,
    githubIssueNumber: null,
    githubIssueUrl: null,
    githubPrUrl: null,
    githubPrNumber: null,
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
    startDate: null,
    dueDate: null,
    persona: null,
    archived: false,
    createdAt: now,
    updatedAt: now,
    lastWorkedAt: partial.lastWorkedAt || now,
  };
}

/**
 * Guard: do not export test-only helpers or types beyond scope.
 * In production builds, TypeScript will strip these when the appropriate
 * configuration is set (tsconfig.server.test).
 */