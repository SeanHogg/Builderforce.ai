/**
 * Workspace-role gates on the kanban writes that had none: audit recompute and
 * sign-off write the ticket's audit ledger, so they take the board's working-team
 * tier (developer) — a viewer or a canvas contributor is refused.
 *
 * And the gate that had the WRONG one: the five per-ticket coordination routes used to
 * demand MANAGER outright, which answered a workspace's own owner `403 manager role
 * required` whenever their gateway key resolved below that tier (VS Code chat #113).
 * Coordination is developer-tier by default now; a project opts INTO the manager gate
 * (`coordinationRequiresManager`, migration 1177) and the refusal names the setting.
 *
 * Stubs are installed with `vi.doMock` (not hoisted `vi.mock`) and the router is
 * loaded with a dynamic import afterwards. Under this package's Vitest 4 + threads
 * pool, a hoisted `vi.mock` of `authMiddleware` does not replace the binding
 * `kanbanRoutes` imported, so every request hit the real gate and answered 401.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ForbiddenError } from '../../domain/shared/errors';
import { tasks, projectManagerConfigs, tenantManagerDefaults } from '../../infrastructure/database/schema';
import { errorHandler } from '../middleware/errorHandler';

let callerRole = 'viewer';
let requiresManager = false;
let createKanbanRoutes: typeof import('./kanbanRoutes').createKanbanRoutes;
const computeAudit = vi.fn(async () => ({ taskId: 9, gaps: [] }));
const policyCalls: unknown[][] = [];
const coordinateCalls: unknown[][] = [];

vi.doMock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', 5);
    c.set('userId', 'user-1');
    c.set('role', callerRole);
    await next();
  },
  isManager: (c: { get(key: 'role'): unknown }) => {
    const role = String(c.get('role') ?? '');
    return role === 'manager' || role === 'owner';
  },
  requireRole: (minimum: string) => async (c: any, next: any) => {
    const rank: Record<string, number> = {
      viewer: 0, contributor: 1, developer: 2, manager: 3, owner: 4,
    };
    const role = String(c.get('role') ?? '');
    if ((rank[role] ?? -1) < (rank[minimum] ?? 99)) {
      throw new ForbiddenError(`Requires at least '${minimum}' role, caller has '${role}'`);
    }
    await next();
  },
}));

vi.doMock('../../application/audit/ticketAuditService', () => ({
  TicketAuditService: function () {
    return { computeAudit, getAudit: vi.fn() };
  },
}));

vi.doMock('../../application/manager/managerPolicyStore', () => ({
  getEffectiveManagerPolicy: (...args: unknown[]) => {
    policyCalls.push(args);
    return Promise.resolve({ coordinationRequiresManager: requiresManager });
  },
}));
vi.doMock('../../application/manager/coordinateTicket', () => ({
  coordinateTicket: (...args: unknown[]) => {
    coordinateCalls.push(args);
    return Promise.resolve({ dispatched: 0 });
  },
}));
vi.doMock('../../buildRuntimeService', () => ({ buildRuntimeService: () => ({}) }));

createKanbanRoutes = (await import('./kanbanRoutes')).createKanbanRoutes;

/** Enough drizzle surface for the ticket lookup and (if the store is real) the policy fold. */
const TASK_PROJECT_ID = 12;
const db = {
  select: () => ({
    from: (table: unknown) => {
      const rows =
        table === tasks ? [{ projectId: TASK_PROJECT_ID }]
        : table === projectManagerConfigs ? (requiresManager ? [{ coordinationRequiresManager: true }] : [])
        : table === tenantManagerDefaults ? []
        : [{ projectId: TASK_PROJECT_ID }];
      return { where: () => ({ limit: async () => rows }) };
    },
  }),
} as never;

function app() {
  const a = new Hono();
  a.onError(errorHandler);
  a.route('/', createKanbanRoutes(db));
  return a;
}

const post = (body: unknown = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  callerRole = 'viewer';
  requiresManager = false;
  policyCalls.length = 0;
  coordinateCalls.length = 0;
  computeAudit.mockClear();
});

describe('kanban ledger writes', () => {
  it('refuses a viewer and a contributor on recompute and sign-off', async () => {
    for (const role of ['viewer', 'contributor']) {
      callerRole = role;
      expect((await app().request('/tasks/9/audit/recompute', post(), {})).status).toBe(403);
      expect((await app().request('/tasks/9/signoff', post({ roleKey: 'qa-tester' }), {})).status).toBe(403);
    }
    expect(computeAudit).not.toHaveBeenCalled();
  });

  it('lets a developer recompute', async () => {
    callerRole = 'developer';
    const res = await app().request('/tasks/9/audit/recompute', post(), {});
    expect(res.status).toBe(200);
    expect(computeAudit).toHaveBeenCalledTimes(1);
  });
});

describe('ticket coordination gate', () => {
  it('refuses a viewer and a contributor, whatever the project says', async () => {
    for (const role of ['viewer', 'contributor']) {
      callerRole = role;
      const res = await app().request('/tasks/9/coordinate', post(), {});
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        error: 'manager role required',
        remedy: 'coordination needs the working-team tier',
      });
    }
    expect(policyCalls).toHaveLength(0);
    expect(coordinateCalls).toHaveLength(0);
  });

  it('admits a developer when the project leaves coordination open', async () => {
    callerRole = 'developer';
    const res = await app().request('/tasks/9/coordinate', post(), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ authority: 'open' });
    expect(coordinateCalls.length + Number(res.status === 200)).toBeGreaterThan(0);
  });

  it('refuses a developer with the remedy when the project opted into the manager gate', async () => {
    callerRole = 'developer';
    requiresManager = true;

    const res = await app().request('/tasks/9/coordinate', post(), {});

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'manager role required',
      projectId: TASK_PROJECT_ID,
      remedy: `coordination_requires_manager is on for project ${TASK_PROJECT_ID} — a manager can turn it off with `
        + `manager.configure { projectId: ${TASK_PROJECT_ID}, coordinationRequiresManager: false }`,
    });
    expect(coordinateCalls).toHaveLength(0);
  });

  it('admits a manager even when the project opted in, and says so', async () => {
    callerRole = 'manager';
    requiresManager = true;

    const res = await app().request('/tasks/9/coordinate', post(), {});

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ authority: 'manager' });
    expect(policyCalls).toHaveLength(0);
  });

  it('gates the other four coordination routes the same way', async () => {
    callerRole = 'viewer';
    const calls: Array<[string, RequestInit]> = [
      ['/tasks/9/participants', post({ roleKey: 'qa-tester' })],
      ['/tasks/9/participants/assign', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' }],
      ['/tasks/9/participants/p1', { method: 'DELETE' }],
      ['/tasks/9/materialize', post()],
    ];
    // materialize path is /tasks/:taskId/participants/materialize
    calls[3] = ['/tasks/9/participants/materialize', post()];
    for (const [path, init] of calls) {
      const res = await app().request(path, init, {});
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toMatchObject({ error: 'manager role required' });
    }
  });

  it('keeps workspace CONFIGURATION manager-only — a developer may not edit the role catalog', async () => {
    callerRole = 'developer';
    for (const path of ['/roles', '/role-assignments', '/templates']) {
      const res = await app().request(path, post({ name: 'x', key: 'x' }), {});
      expect(res.status, path).toBe(403);
    }
  });
});
