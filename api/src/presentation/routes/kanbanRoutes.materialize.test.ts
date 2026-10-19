/**
 * The materialize endpoint must not put an LLM cascade in front of its response.
 *
 * `POST /tasks/:taskId/participants/materialize` creates one child task per staffed
 * participant. Each of those creates goes through `TaskService.createTask`, which on an
 * AGENT-ASSIGNED task runs the on-assign Epic assessment — in production the LLM
 * free-model cascade. Awaiting that inline meant ONE user action ran ONE full cascade
 * PER PARTICIPANT before responding: 1,158 error events in the measured window, the
 * slowest call 5m 6s.
 *
 * What must stay on the response path is the cheap part: the child rows are written and
 * COUNTED before the response, because `created` is the number the %-complete rollup
 * depends on. What moves off it is the agent fan-out.
 *
 * The regression is therefore NOT "child creation hangs" — creates are deliberately
 * inline. It is "the ASSESSMENT behind a fast create hangs", so these tests wire the
 * route's `createChild` port to a REAL `TaskService` carrying a decomposer whose
 * `assess()` never settles, and assert the response still goes out with the full count
 * while the assessment is left running on the execution context.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { TenantRole, TaskType } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { tasks, ticketParticipants, ticketRoleSignoffs } from '../../infrastructure/database/schema';
import { errorHandler } from '../middleware/errorHandler';
import { createKanbanRoutes } from './kanbanRoutes';
import { TaskService } from '../../application/task/TaskService';
import type { EpicDecomposer } from '../../application/task/EpicDecomposer';
import { Task } from '../../domain/task/Task';

/** Task ids the stub task repo hands out; the participant links point at these. */
const TASK_ID = 42;
const PROJECT_ID = 12;
const TENANT_ID = 5;
const PARENT_TITLE = 'Ship the thing';

/** A participant row that will produce a child: staffed with an agent, not yet materialized. */
const PARTICIPANTS = [
  { id: 'p1', taskId: TASK_ID, roleKey: 'developer', assigneeKind: 'agent', assigneeRef: 'ada', childTaskId: null },
  { id: 'p2', taskId: TASK_ID, roleKey: 'qa-tester', assigneeKind: 'agent', assigneeRef: 'qa', childTaskId: null },
  { id: 'p3', taskId: TASK_ID, roleKey: 'manager', assigneeKind: 'human', assigneeRef: 'u-9', childTaskId: null },
  // Already materialized, and unstaffed: neither may be created again.
  { id: 'p4', taskId: TASK_ID, roleKey: 'developer', assigneeKind: 'agent', assigneeRef: 'ada', childTaskId: 777 },
  { id: 'p5', taskId: TASK_ID, roleKey: 'owner', assigneeKind: null, assigneeRef: null, childTaskId: null },
];

/** Drizzle surface for the parent's project lookup, the participants read and the links. */
function dbStub() {
  const chain = (rows: unknown[]) => {
    const value: Record<string, unknown> = {};
    const self = () => value;
    value.from = self;
    value.where = self;
    value.orderBy = self;
    value.limit = async () => rows;
    value.then = (resolve: (result: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return value;
  };
  const batch = vi.fn(async () => []);
  // Table-aware, because the handler reads three different tables: the parent task
  // (project id + title), the participant rows, and — in the rollup — child statuses.
  const rowsFor = (table: unknown): unknown[] => {
    if (table === ticketParticipants) return PARTICIPANTS;
    if (table === ticketRoleSignoffs) return [];
    if (table === tasks) return [{ id: TASK_ID, projectId: PROJECT_ID, title: PARENT_TITLE, status: 'todo' }];
    return [];
  };
  return {
    batch,
    select: vi.fn(() => ({ ...chain([]), from: (table: unknown) => chain(rowsFor(table)) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
  } as unknown as Db;
}

/**
 * A decomposer that never answers. This is the free-pool cascade at its worst: every
 * candidate 429s or returns 200 with no content, so `assess()` sits in the pool walk
 * instead of returning. Nothing about the route should wait on it.
 */
function hangingDecomposer() {
  const assess = vi.fn(() => new Promise<never>(() => {}));
  return { decomposer: { assess } satisfies Partial<EpicDecomposer> as EpicDecomposer, assess };
}

const MATERIALIZE = `/tasks/${TASK_ID}/participants/materialize`;
const post = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' };

/** Mount the route as a manager, capturing whatever it hands to `waitUntil`. */
function managerApp(createChild: Parameters<typeof createKanbanRoutes>[1]) {
  const waited: Array<Promise<unknown>> = [];
  const a = new Hono<HonoEnv>();
  a.onError(errorHandler);
  a.use('*', async (c, next) => {
    c.set('isEmulation', true);
    c.set('tenantId', TENANT_ID);
    c.set('userId', 'user-1');
    c.set('role', TenantRole.MANAGER);
    // Hono only exposes `executionCtx` when the request carries one; supply a stand-in
    // so the route can attach its fan-out the way production's `index.ts` does.
    Object.defineProperty(c, 'executionCtx', {
      value: { waitUntil: (task: Promise<unknown>) => { waited.push(task); } },
      configurable: true,
    });
    await next();
  });
  a.route('/', createKanbanRoutes(dbStub(), createChild));
  return { app: a, waited };
}

describe('materialize: the agent fan-out never blocks the response', () => {
  it('answers with the created count while the assessment behind it never settles', async () => {
    const { decomposer, assess } = hangingDecomposer();
    const service = new TaskService(stubTaskRepo(), stubProjectRepo(), decomposer);
    const createChild = vi.fn(async (input: { projectId: number; tenantId: number; title: string; parentTaskId: number; assignedAgentRef?: string | null; assignedUserId?: string | null }) => {
      // Mirrors the real composition-root lambda (`index.ts`): the port drops unknown
      // fields, so the child create carries exactly these and a plain TASK type.
      const task = await service.createTask({
        projectId: input.projectId,
        title: input.title,
        taskType: TaskType.TASK,
        parentTaskId: input.parentTaskId,
        assignedAgentRef: input.assignedAgentRef ?? undefined,
        assignedUserId: input.assignedUserId ?? undefined,
      }, input.tenantId);
      return { id: Number(task.id) };
    });

    const { app, waited } = managerApp(createChild as never);

    const res = await app.request(MATERIALIZE, post, {});
    const body = await res.json() as { created: number };

    expect(res.status).toBe(200);
    // p1 + p2 + p3: p4 already has a child, p5 has no assignee. Counted before responding.
    expect(body).toEqual({ created: 3 });
    // The two agent-assigned children each kicked off an assessment; none of it is awaited.
    expect(assess).toHaveBeenCalledTimes(2);
    // Each assessment fan-out was handed to the execution context instead of being left
    // floating, and so was the post-create rollup (syncStates + bump) — three deferred
    // tasks, none of them in front of the response.
    expect(waited.length).toBe(3);
  });

  it('reports the count even when a child create is still slow but resolves', async () => {
    // The count is the contract, not the latency: a create that takes a beat must still
    // be included, because the rollup reads `created`.
    const service = new TaskService(stubTaskRepo(), stubProjectRepo(), hangingDecomposer().decomposer);
    let nextId = 0;
    const createChild = vi.fn(async (input: { assignedAgentRef?: string | null }) => {
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      const task = await service.createTask({
        projectId: PROJECT_ID,
        title: 'child',
        taskType: TaskType.TASK,
        parentTaskId: TASK_ID,
        assignedAgentRef: input.assignedAgentRef ?? undefined,
      }, TENANT_ID);
      return { id: Number(task.id) + (nextId += 1) };
    });

    const { app } = managerApp(createChild as never);

    const res = await app.request(MATERIALIZE, post, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 3 });
  });

  it('still refuses a non-manager, and 503s without the create port', async () => {
    const viewer = new Hono<HonoEnv>();
    viewer.onError(errorHandler);
    viewer.use('*', async (c, next) => {
      c.set('isEmulation', true);
      c.set('tenantId', TENANT_ID);
      c.set('userId', 'user-1');
      c.set('role', TenantRole.VIEWER);
      await next();
    });
    viewer.route('/', createKanbanRoutes(dbStub(), vi.fn(async () => ({ id: 1 }))));

    const refused = await viewer.request(MATERIALIZE, post, {});
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: 'manager role required' });

    // No port ⇒ the service cannot allocate a child key: refuse rather than half-create.
    const a = new Hono<HonoEnv>();
    a.onError(errorHandler);
    a.use('*', async (c, next) => {
      c.set('isEmulation', true);
      c.set('tenantId', TENANT_ID);
      c.set('userId', 'user-1');
      c.set('role', TenantRole.MANAGER);
      await next();
    });
    a.route('/', createKanbanRoutes(dbStub()));
    const noPort = await a.request(MATERIALIZE, post, {});
    expect(noPort.status).toBe(503);
  });
});

/** Minimal repositories: `createTask` needs key allocation, save, and the project. */
function stubTaskRepo() {
  let next = 500;
  return {
    async findById() { return null as never; },
    async maxKeySeqByProject() { return 0; },
    async save(task: Task) {
      next += 1;
      // Return a REAL Task: `createTask` reads prototype getters off the saved
      // aggregate (`isAssignedToAgent`, `taskType`, `id`), which a spread plain
      // object would silently drop.
      return Task.reconstitute({ ...task.toPlain(), id: next } as never);
    },
  } as never;
}

function stubProjectRepo() {
  return { findById: async () => ({ id: PROJECT_ID, tenantId: TENANT_ID, key: 'PRJ' }) as never } as never;
}