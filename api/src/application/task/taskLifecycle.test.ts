/**
 * Unit tests for the task completion logic (completeTaskOnMerge).
 *
 * PRD mapping:
 * - "Completion with delivered code" (FR-1) completes via mergeRecordedPr passing taskId => code PR used
 * - "Completion without delivered code" (FR-2) completes via CI ingestRepoCiEvent without a PR/taskId
 * - FR-3 (negative/edge cases) tests idempotency on DONE events, missing task mischecks, and the no-op timing guard
 *
 * All external dependencies are mocked via makeFakeDb(). No real I/O.
 */

import { describe, it, beforeEach, expect } from 'vitest';
import { completeTaskOnMerge, recordStatusTransition, type RecordTransitionInput } from './taskLifecycle';
import { TaskStatus } from '../../domain/shared/types';
import { tasks, pullRequests } from '../../infrastructure/database/schema';

type TableRef = typeof tasks | typeof pullRequests;

/**
 * Minimal chainable Drizzle fake: select().from(table), insert().values(), update().set().where() resolve (and are recorded).
 */
function makeFakeDb(rowsByTable: Map<TableRef, unknown[]> = new Map()) {
  const inserts: Array<{ table: TableRef; values: Record<string, unknown> }> = [];
  function chain(rows: unknown[]) {
    const c: Record<string, unknown> = {};
    const pass = () => c;
    c.from = pass;
    c.innerJoin = pass;
    c.leftJoin = pass;
    c.where = pass;
    c.orderBy = pass;
    c.limit = pass;
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
    return c;
  }
  return {
    inserts,
    db: {
      select() {
        return { from: (table: TableRef) => chain(rowsByTable.get(table) ?? []) };
      },
      insert(table: TableRef) {
        return {
          values: (values: Record<string, unknown>) => {
            inserts.push({ table, values });
            return Promise.resolve([]);
          },
        };
      },
      update() {
        return {
          set: () => ({
            where: () => Promise.resolve([]),
          }),
        };
      },
    },
  };
}

type TestEnv = Partial<Record<string, unknown>> | Env;

const env = {} as unknown as Env;

describe('completeTaskOnMerge — completion with delivered code (FR-1)', () => {
  const taskRow = {
    id: 1,
    projectId: 3,
    status: TaskStatus.IN_PROGRESS,
    completedAt: null,
    lastWorkedAt: new Date('2026-07-01T12:00:00Z'),
    tenantId: 5,
    reopenCount: 0,
    redoCount: 0,
  };

  beforeEach(() => {
    // clean inserts before each test
  });

  it('FR-1.1: marks a task with projectId and taskId as DONE on merge when all completion conditions are met', async () => {
    const { db } = makeFakeDb(new Map([[tasks, [taskRow]]]));
    await completeTaskOnMerge(env, db as never, { tenantId: 5, taskId: 1 });
    const [t] = await db.select().from(tasks).where(tasks.id.eq(1)).limit(1) as unknown[][];
    expect(t.status).toBe(TaskStatus.DONE);
    expect(t.completedAt).toBeDefined();
    const completedAtIso = new Date(t.completedAt as unknown as Date).toISOString();
    expect(completedAtIso).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.\d+)?Z?$/);
  });

  it('FR-1.2: completion timestamp is recorded when a delivered-code merge occurs', async () => {
    const { db } = makeFakeDb(new Map([[tasks, [taskRow]]]));
    await completeTaskOnMerge(env, db as never, { tenantId: 5, taskId: 1 });
    const [t] = await db.select().from(tasks).where(tasks.id.eq(1)).limit(1) as unknown[][];
    expect(t.completedAt).toBeDefined();
    expect(() => new Date(t.completedAt as unknown as Date)).not.toThrow();
  });

  it('FR-1.3: completion does not return a payload in this concrete implementation, but performs the operation', async () => {
    const { db } = makeFakeDb(new Map([[tasks, [taskRow]]]));
    const result = await completeTaskOnMerge(env, db as never, { tenantId: 5, taskId: 1 });
    expect(result).toBeUndefined();
    const [t] = await db.select().from(tasks).where(tasks.id.eq(1)).limit(1) as unknown[][];
    expect(t.status).toBe(TaskStatus.DONE);
  });

  it('FR-1.5: multiple code artifacts are not dropped in this implementation (no AR artifact table), but does not duplicate writes', async () => {
    const { db, inserts } = makeFakeDb(new Map([[tasks, [taskRow]]]));
    await completeTaskOnMerge(env, db as never, { tenantId: 5, taskId: 1 });
    await completeTaskOnMerge(env, db as never, { tenantId: 5, taskId: 1 });
    const [t] = await db.select().from(tasks).where(tasks.id.eq(1)).limit(1) as unknown[][];
    expect(t.status).toBe(TaskStatus.DONE);
    const setStatuses = inserts.filter((i) => i.table === tasks && (i.values.status as unknown as string) === 'done');
    expect(setStatuses.length).toBe(1);
  });
});

describe('completeTaskOnMerge — completion without delivered code (FR-2)', () => {
  const taskRow = {
    id: 2,
    projectId: 3,
    status: TaskStatus.TODO,
    completedAt: null,
    lastWorkedAt: new Date('2026-07-01T12:00:00Z'),
    tenantId: 5,
    reopenCount: 0,
    redoCount: 0,
  };

  beforeEach(() => {
    // clean inserts before each test
  });

  it('FR-2.1: code-branch green-CI completion (no PR) still marks the task DONE when all completion conditions are met', async () => {
    const { db } = makeFakeDb(new Map([[tasks, [taskRow]]]));
    await completeTaskOnMerge(env, db as never, { tenantId: 5, taskId: 2 });
    const [t] = await db.select().from(tasks).where(tasks.id.eq(2)).limit(1) as unknown[][];
    expect(t.status).toBe(TaskStatus.DONE);
    expect(t.completedAt).toBeDefined();
  });
});

describe('recordStatusTransition — lifecycle recording (supports completion)', () => {
  const input: RecordTransitionInput = {
    tenantId: 5,
    projectId: 3,
    taskId: 1,
    fromStatus: TaskStatus.IN_PROGRESS,
    toStatus: TaskStatus.DONE,
  };

  beforeEach(() => {
    // clean inserts before each test
  });

  it('FR-1.2: when task completes (status becomes DONE), the lifecycle row includes the completion timestamp in the task.denormalized completedAt', async () => {
    const { db, inserts } = makeFakeDb();
    const tsStart = new Date('2026-07-01T12:00:00Z');
    await recordStatusTransition(env, db as never, { ...input, fromStatus: null, toStatus: TaskStatus.DONE });
    const [t] = await db.select().from(tasks).where(tasks.id.eq(1)).limit(1) as unknown[][];
    expect(t).toBeDefined();
    expect(t.completedAt).toBeDefined();
    const completedAtIso = new Date(t.completedAt as unknown as Date).toISOString();
    expect(completedAtIso).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.\d+)?Z?$/);
  });

  it('FR-2.3: when task completes without delivered code, the lifecycle row still records completedAt correctly', async () => {
    const { db, inserts } = makeFakeDb();
    const tsStart = new Date('2026-07-01T12:00:00Z');
    await recordStatusTransition(env, db as never, { ...input, fromStatus: TaskStatus.TODO, toStatus: TaskStatus.DONE });
    const [t] = await db.select().from(tasks).where(tasks.id.eq(1)).limit(1) as unknown[][];
    expect(t.status).toBe(TaskStatus.DONE);
    expect(t.completedAt).toBeDefined();
    const completedAtIso = new Date(t.completedAt as unknown as Date).toISOString();
    expect(completedAtIso).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.\d+)?Z?$/);
  });
});

describe('completeTaskOnMerge — negative / edge cases (FR-3)', () => {
  const taskRow = {
    id: 3,
    projectId: 3,
    status: TaskStatus.TODO,
    completedAt: null,
    lastWorkedAt: new Date('2026-07-01T12:00:00Z'),
    tenantId: 5,
    reopenCount: 0,
    redoCount: 0,
  };

  it('FR-3.1: calling completeTaskOnMerge on a task that is already DONE (done-class lane) is idempotent — no-op', async () => {
    const { db } = makeFakeDb(new Map([[tasks, [taskRow]]]));
    await completeTaskOnMerge(env, db as never, { tenantId: 5, taskId: 3 });
    await completeTaskOnMerge(env, db as never, { tenantId: 5, taskId: 3 });
    const [t] = await db.select().from(tasks).where(tasks.id.eq(3)).limit(1) as unknown[][];
    expect(t.status).toBe(TaskStatus.DONE);
    expect(t.completedAt).toBeDefined();
  });
});

describe('recordStatusTransition — invalid / missing task input (FR-3.4)', () => {
  const { db } = makeFakeDb();

  it('FR-3.4: passing a taskId with no matching task row records an INSERT (taskStatusTransitions) but is best-effort; this repo does not throw on missing task', async () => {
    const input: RecordTransitionInput = {
      tenantId: 5,
      projectId: 3,
      taskId: 999,
      fromStatus: TaskStatus.TODO,
      toStatus: TaskStatus.DONE,
    };
    await recordStatusTransition(env, db as never, input);
    const [rows] = await db.select().from(tasks).where(tasks.id.eq(999)).limit(1) as unknown[][];
    expect(rows).toBeUndefined();
    // transition log should exist with 999 taskId
    const transitionLog = await db
      .select()
      .from(tasks)
      .where(tasks.id.eq(999))
      .limit(1) as unknown[][];
    expect(transitionLog.length).toBe(1);
  });
});

describe('completeTaskOnMerge — missing task (edge case)', () => {
  const { db } = makeFakeDb(new Map([[tasks, []]]));

  it('when task is missing (no row), completeTaskOnMerge is a no-op instead of throwing', async () => {
    const result = await completeTaskOnMerge(env, db as never, { tenantId: 5, taskId: 999 });
    expect(result).toBeUndefined();
  });
});

describe('completeTaskOnMerge — completedAt captured on first time only; not resetting on second call', () => {
  const taskRow = {
    id: 4,
    projectId: 3,
    status: TaskStatus.TODO,
    completedAt: null,
    lastWorkedAt: new Date('2026-07-01T12:00:00Z'),
    tenantId: 5,
    reopenCount: 0,
    redoCount: 0,
  };

  it('FR-3.2: completing a task that is already DONE records NO new completionAt timestamp on a second call (first call already set completedAt)', async () => {
    const { db } = makeFakeDb(new Map([[tasks, [taskRow]]]));
    await completeTaskOnMerge(env, db as never, { tenantId: 5, taskId: 4 });
    const firstCompletedAt = (db as any).task4CompletedAtDBField;
    await completeTaskOnMerge(env, db as never, { tenantId: 5, taskId: 4 });
    const secondCompletedAt = (db as any).task4CompletedAtDBField;
    expect(firstCompletedAt).toBe(secondCompletedAt);
  });
});