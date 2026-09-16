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
 * Auth is the REAL middleware. This package's Vitest 4 + threads pool does not honour
 * `vi.mock` of `authMiddleware` (the same 401 shows up on `agileRoutes.test.ts`), so
 * the tests set the documented emulation skip (`isEmulation`) on the outer Hono app
 * and stamp tenant/role onto the shared request context. The gate and `requireRole`
 * then read `c.get('role')` exactly as production does.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { tasks, projectManagerConfigs, tenantManagerDefaults } from '../../infrastructure/database/schema';
import { errorHandler } from '../middleware/errorHandler';
import { createKanbanRoutes } from './kanbanRoutes';

let callerRole: TenantRole = TenantRole.VIEWER;
let requiresManager = false;

const TASK_PROJECT_ID = 12;

/** Enough drizzle surface for the ticket lookup and the real policy fold. */
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
} as unknown as Db;

function app() {
  const a = new Hono<HonoEnv>();
  a.onError(errorHandler);
  a.use('*', async (c, next) => {
    c.set('isEmulation', true);
    c.set('tenantId', 5);
    c.set('userId', 'user-1');
    c.set('role', callerRole);
    await next();
  });
  a.route('/', createKanbanRoutes(db));
  return a;
}

const post = (body: unknown = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Gate opened: not a role refusal. Downstream services may 500 on the stub db. */
function expectAdmitted(status: number, body: { error?: string }, authority?: string) {
  expect(status).not.toBe(401);
  expect(body.error).not.toBe('manager role required');
  if (status === 200 && authority) expect(body).toMatchObject({ authority });
}

beforeEach(() => {
  callerRole = TenantRole.VIEWER;
  requiresManager = false;
});

describe('kanban ledger writes', () => {
  it('refuses a viewer and a contributor on recompute and sign-off', async () => {
    for (const role of [TenantRole.VIEWER, TenantRole.CONTRIBUTOR]) {
      callerRole = role;
      expect((await app().request('/tasks/9/audit/recompute', post(), {})).status).toBe(403);
      expect((await app().request('/tasks/9/signoff', post({ roleKey: 'qa-tester' }), {})).status).toBe(403);
    }
  });

  it('lets a developer past the recompute role gate', async () => {
    callerRole = TenantRole.DEVELOPER;
    const res = await app().request('/tasks/9/audit/recompute', post(), {});
    const body = await res.json() as { error?: string };
    expectAdmitted(res.status, body);
  });
});

describe('ticket coordination gate', () => {
  it('refuses a viewer and a contributor, whatever the project says', async () => {
    for (const role of [TenantRole.VIEWER, TenantRole.CONTRIBUTOR]) {
      callerRole = role;
      const res = await app().request('/tasks/9/coordinate', post(), {});
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        error: 'manager role required',
        remedy: 'coordination needs the working-team tier',
      });
    }
  });

  it('admits a developer when the project leaves coordination open', async () => {
    callerRole = TenantRole.DEVELOPER;
    const res = await app().request('/tasks/9/coordinate', post(), {});
    const body = await res.json() as { error?: string; authority?: string };
    expectAdmitted(res.status, body, 'open');
  });

  it('refuses a developer with the remedy when the project opted into the manager gate', async () => {
    callerRole = TenantRole.DEVELOPER;
    requiresManager = true;

    const res = await app().request('/tasks/9/coordinate', post(), {});

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'manager role required',
      projectId: TASK_PROJECT_ID,
      remedy: `coordination_requires_manager is on for project ${TASK_PROJECT_ID} — a manager can turn it off with `
        + `manager.configure { projectId: ${TASK_PROJECT_ID}, coordinationRequiresManager: false }`,
    });
  });

  it('admits a manager even when the project opted in, and says so', async () => {
    callerRole = TenantRole.MANAGER;
    requiresManager = true;

    const res = await app().request('/tasks/9/coordinate', post(), {});
    const body = await res.json() as { error?: string; authority?: string };
    expectAdmitted(res.status, body, 'manager');
  });

  it('gates the other four coordination routes the same way', async () => {
    callerRole = TenantRole.VIEWER;
    const calls: Array<[string, RequestInit]> = [
      ['/tasks/9/participants', post({ roleKey: 'qa-tester' })],
      ['/tasks/9/participants/assign', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' }],
      ['/tasks/9/participants/p1', { method: 'DELETE' }],
      ['/tasks/9/participants/materialize', post()],
    ];
    for (const [path, init] of calls) {
      const res = await app().request(path, init, {});
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toMatchObject({ error: 'manager role required' });
    }
  });

  it('keeps workspace CONFIGURATION manager-only — a developer may not edit the role catalog', async () => {
    callerRole = TenantRole.DEVELOPER;
    for (const path of ['/roles', '/role-assignments', '/templates']) {
      const res = await app().request(path, post({ name: 'x', key: 'x' }), {});
      expect(res.status, path).toBe(403);
    }
  });
});
