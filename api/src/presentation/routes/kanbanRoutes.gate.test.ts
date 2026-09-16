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
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const state = vi.hoisted(() => ({ role: 'viewer' as string }));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/authMiddleware')>();
  return {
    ...actual,
    authMiddleware: async (c: any, next: any) => {
      c.set('tenantId', 5);
      c.set('userId', 'user-1');
      c.set('role', state.role);
      await next();
    },
  };
});

const computeAudit = vi.hoisted(() => vi.fn(async () => ({ taskId: 9, gaps: [] })));
vi.mock('../../application/audit/ticketAuditService', () => ({
  TicketAuditService: function () { return { computeAudit, getAudit: vi.fn() }; },
}));

// The gate's ONLY IO beyond the task lookup. Mocked here so the gate's own decision —
// not a database — is what these cases exercise.
const mocks = vi.hoisted(() => ({
  getEffectiveManagerPolicy: vi.fn(async () => ({ coordinationRequiresManager: false })),
  coordinateTicket: vi.fn(async () => ({ dispatched: 0 })),
}));
vi.mock('../../application/manager/managerPolicyStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/manager/managerPolicyStore')>()),
  getEffectiveManagerPolicy: mocks.getEffectiveManagerPolicy,
}));
vi.mock('../../application/manager/coordinateTicket', () => ({ coordinateTicket: mocks.coordinateTicket }));
vi.mock('../../buildRuntimeService', () => ({ buildRuntimeService: () => ({}) }));

const { createKanbanRoutes } = await import('./kanbanRoutes');
const { errorHandler } = await import('../middleware/errorHandler');

/** Enough drizzle surface for the one `select projectId from tasks` the gate makes. */
const TASK_PROJECT_ID = 12;
const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ projectId: TASK_PROJECT_ID }] }) }) }),
} as never;

function app() {
  const a = new Hono();
  a.onError(errorHandler);
  a.route('/', createKanbanRoutes(db));
  return a;
}

const post = (body: unknown = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  mocks.getEffectiveManagerPolicy.mockClear();
  mocks.coordinateTicket.mockClear();
  mocks.getEffectiveManagerPolicy.mockResolvedValue({ coordinationRequiresManager: false });
});

describe('kanban ledger writes', () => {
  it('refuses a viewer and a contributor on recompute and sign-off', async () => {
    for (const role of ['viewer', 'contributor']) {
      state.role = role;
      expect((await app().request('/tasks/9/audit/recompute', post(), {})).status).toBe(403);
      expect((await app().request('/tasks/9/signoff', post({ roleKey: 'qa-tester' }), {})).status).toBe(403);
    }
    expect(computeAudit).not.toHaveBeenCalled();
  });

  it('lets a developer recompute', async () => {
    state.role = 'developer';
    const res = await app().request('/tasks/9/audit/recompute', post(), {});
    expect(res.status).toBe(200);
    expect(computeAudit).toHaveBeenCalledTimes(1);
  });
});

describe('ticket coordination gate', () => {
  it('refuses a viewer and a contributor, whatever the project says', async () => {
    for (const role of ['viewer', 'contributor']) {
      state.role = role;
      const res = await app().request('/tasks/9/coordinate', post(), {});
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        error: 'manager role required',
        remedy: 'coordination needs the working-team tier',
      });
    }
    // Below the floor the answer cannot change, so the policy is never read.
    expect(mocks.getEffectiveManagerPolicy).not.toHaveBeenCalled();
    expect(mocks.coordinateTicket).not.toHaveBeenCalled();
  });

  it('admits a developer when the project leaves coordination open', async () => {
    state.role = 'developer';
    const res = await app().request('/tasks/9/coordinate', post(), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ authority: 'open' });
    expect(mocks.coordinateTicket).toHaveBeenCalledTimes(1);
  });

  it('refuses a developer with the remedy when the project opted into the manager gate', async () => {
    state.role = 'developer';
    mocks.getEffectiveManagerPolicy.mockResolvedValue({ coordinationRequiresManager: true });

    const res = await app().request('/tasks/9/coordinate', post(), {});

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'manager role required',
      projectId: TASK_PROJECT_ID,
      remedy: `coordination_requires_manager is on for project ${TASK_PROJECT_ID} — a manager can turn it off with `
        + `manager.configure { projectId: ${TASK_PROJECT_ID}, coordinationRequiresManager: false }`,
    });
    expect(mocks.coordinateTicket).not.toHaveBeenCalled();
  });

  it('admits a manager even when the project opted in, and says so', async () => {
    state.role = 'manager';
    mocks.getEffectiveManagerPolicy.mockResolvedValue({ coordinationRequiresManager: true });

    const res = await app().request('/tasks/9/coordinate', post(), {});

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ authority: 'manager' });
    // A manager's verdict needs no policy read — the gate can only tighten below them.
    expect(mocks.getEffectiveManagerPolicy).not.toHaveBeenCalled();
  });

  it('gates the other four coordination routes the same way', async () => {
    state.role = 'viewer';
    const calls: Array<[string, RequestInit]> = [
      ['/tasks/9/participants', post({ roleKey: 'qa-tester' })],
      ['/tasks/9/participants/assign', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' }],
      ['/tasks/9/participants/p1', { method: 'DELETE' }],
      ['/tasks/9/participants/materialize', post()],
    ];
    for (const [path, init] of calls) {
      const res = await app().request(path, init, {});
      expect(res.status, path).toBe(403);
      expect((await res.json()).error, path).toBe('manager role required');
    }
  });

  it('keeps workspace CONFIGURATION manager-only — a developer may not edit the role catalog', async () => {
    state.role = 'developer';
    for (const path of ['/roles', '/role-assignments', '/templates']) {
      const res = await app().request(path, post({ name: 'x', key: 'x' }), {});
      expect(res.status, path).toBe(403);
    }
  });
});
