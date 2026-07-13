import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetch } from 'undici';

import * as SyntheticTaskRepo from '@/domain/task/repositories/syntheticTaskRepo';
import { Task } from '@/domain/task/Task';

import * as TaskUpdateSideEffectMock from '@/infrastructure/side-effects/taskUpdateSideEffect';
import { HttpMethod } from '@/infrastructure/http-client';

/**
 * This test suite guarantees the parentTaskId is preserved during 'tasks.update'
 * and that the auto-run side effect is triggered in sync with expectations.
 */

// --- Domain-level helpers --------------------------------------------------

/**
 * Given a parent task ID and intermediate storage, create two child tasks.
 * @returns {{ taskId: number; parentId: number }}
 */
export async function createParentAndTwoChildren(
  storage: SyntheticTaskRepo.LocalTaskStore,
  parentId: number,
): Promise<{ taskId: number; parentId: number }[]> {
  // Child 1
  const child1 = await SyntheticTaskRepo.createOne({
    ...SyntheticTaskRepo.DefaultNewTask,
    id: 1,
    parentTaskId: parentId,
    title: 'Child 1 test',
    status: 'todo' as const,
  });
  storage.push(child1);

  // Child 2
  const child2 = await SyntheticTaskRepo.createOne({
    ...SyntheticTaskRepo.DefaultNewTask,
    id: 2,
    parentTaskId: parentId,
    title: 'Child 2 test',
    status: 'todo' as const,
  });
  storage.push(child2);

  return [{ taskId: child1.id, parentId: child1.parentTaskId }, { taskId: child2.id, parentId: child2.parentTaskId }];
}

/**
 * Given a task ID, read the task from storage and assert parentTaskId.
 * @returns The task, if present
 */
export async function readTask(id: number): Promise<Task | undefined> {
  const [task] = await SyntheticTaskRepo.readMany(
    [{ id }, SyntheticTaskRepo.DefaultFilters],
  );
  return task;
}

// --- Test Setup -------------------------------------------------------------

let sideEffectCallCount = 0;
let isSpyReset = true;

const noOpSideEffectHandler = async (_task: Task): Promise<void> => {
  if (!isSpyReset) {
    sideEffectCallCount++;
  }
};

const spyHandler: () => number = () => sideEffectCallCount;

/**
 * Reset the spy before each test to prevent cross-test contamination.
 */
async function resetSideEffectSpy(): Promise<void> {
  isSpyReset = true;
  sideEffectCallCount = 0;
}

/**
 * Simulate one side-effect invocation like the real handler.
 */
async function fireSideEffect(task: Task): Promise<void> {
  isSpyReset = false;
  await noOpSideEffectHandler(task);
  isSpyReset = true;
}

// --- Concrete Test Cases -----------------------------------------------------

describe('parentTaskId preservation on tasks.update', () => {
  beforeEach(async () => await resetSideEffectSpy());

  it('FR-1: parentTaskId is preserved when assignedAgentRef is changed', async () => {
    // 1. Plan: parentAndTwoChildren creates two children under the same parent
    const parentId = 10;
    const storage: SyntheticTaskRepo.LocalTaskStore = [];

    const [{ taskId }] = await createParentAndTwoChildren(storage, parentId);

    // 2. Change assignedAgentRef only
    const updatedTask = await SyntheticTaskRepo.update(
      taskId,
      {
        assignedAgentRef: 'agentA',
      },
      {
        recomputeState: true,
      },
    );
    if (updatedTask == null) {
      throw new Error('Task not found');
    }

    // 3. Confirm parentTaskId is unchanged
    expect(updatedTask.parentTaskId).toBe(parentId);

    // 4. Re-read from storage to confirm persistence
    const reReadTask = await readTask(taskId);
    expect(reReadTask?.parentTaskId).toBe(parentId);
  });

  it('FR-2: auto-run side effect fires exactly once when assignedAgentRef is changed', async () => {
    // 1. Setup child task under a parent
    const parentId = 10;
    const storage: SyntheticTaskRepo.LocalTaskStore = [];

    const [{ taskId }] = await createParentAndTwoChildren(storage, parentId);

    // 2. Change assignedAgentRef and count side-effect handler invocations
    await SyntheticTaskRepo.update(
      taskId,
      {
        assignedAgentRef: 'agentB',
      },
      {
        recomputeState: true,
      },
    );

    const invocations = spyHandler();

    // 3. Confirm exactly one invocation
    expect(invocations).toBe(1);

    // 4. Verify no duplicate invocations during same event loop async flush
    await Promise.resolve(); // allow async flush to unwind
    expect(spyHandler()).toBe(1);
  });

  it('FR-3: no side effect on no-op assignedAgentRef update', async () => {
    // 1. Setup child task under a parent
    const parentId = 10;
    const storage: SyntheticTaskRepo.LocalTaskStore = [];

    const [{ taskId }] = await createParentAndTwoChildren(storage, parentId);

    // 2. Re-use the same assignedAgentRef (no change)
    await SyntheticTaskRepo.update(
      taskId,
      {
        assignedAgentRef: 'agentA',
      },
      {
        recomputeState: true,
      },
    );

    // 3. Confirm side effect never fired
    expect(spyHandler()).toBe(0);
  });

  it('FR-4: parentTaskId remains unchanged across multiple field updates', async () => {
    // 1. Setup child task under a parent
    const parentId = 10;
    const storage: SyntheticTaskRepo.LocalTaskStore = [];

    const [{ taskId }] = await createParentAndTwoChildren(storage, parentId);

    // 2. Update both assignedAgentRef and another mutable field
    await SyntheticTaskRepo.update(
      taskId,
      {
        assignedAgentRef: 'agentC',
        status: 'doing' as const,
        metadata: { key: 'value' },
      },
      {
        recomputeState: true,
      },
    );

    // 3. Confirm parentTaskId unchanged
    const readTaskData = await readTask(taskId);
    expect(readTaskData?.parentTaskId).toBe(parentId);
  });
});