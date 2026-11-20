/**
 * PRD 48 §4.0 / §4.5 — the project's ship mode is read and written ONLY through the manager
 * config route and the workspace-defaults route (and `manager.configure`, which replays the
 * PUT). Pinned here: both routes accept the four modes and `null` (inherit), reject anything
 * else with a 400 before a write, record the mode on the audit timeline, and `GET` / `PUT`
 * return the derived `shipPolicy` a run would follow.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTieredManagerPolicy, type ManagerConfigRow, type TenantManagerDefaultsRow } from '../../application/manager/managerPolicy';

const TENANT = 7;
// The REAL `requireRole` runs: only the authenticated identity is faked, so the role gate is under test.
vi.mock('../middleware/authMiddleware', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('userId', 'user-1');
    c.set('role', h.role);
    await next();
  },
}));

const h = vi.hoisted(() => ({
  role: 'manager',
  project: null as Record<string, unknown> | null,
  tenant: null as Record<string, unknown> | null,
  upsertConfig: vi.fn(),
  upsertDefaults: vi.fn(),
  activity: vi.fn(async () => undefined),
}));

vi.mock('../../application/manager/ManagerService', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getManagerConfigRow: vi.fn(async () => h.project),
  upsertManagerConfig: h.upsertConfig,
  getEffectiveManagerPolicy: vi.fn(async () => resolveTieredManagerPolicy({ tenant: h.tenant as never, project: h.project as never })),
  getTenantManagerDefaults: vi.fn(async () => h.tenant),
  upsertTenantManagerDefaults: h.upsertDefaults,
  syncManagerRosterRole: vi.fn(async () => undefined),
}));
vi.mock('../../application/manager/stallCensus', async (orig) => ({
  ...(await orig<Record<string, unknown>>()), invalidateStallCensus: vi.fn(async () => undefined),
}));
vi.mock('../../application/project/projectOwnership', async (orig) => ({
  ...(await orig<Record<string, unknown>>()), loadProjectInTenant: vi.fn(async () => ({ id: 3 })),
}));
vi.mock('../../application/activity/activityLog', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  recordActivity: h.activity,
  resolveActorFromContext: vi.fn(async () => ({ kind: 'user', id: 'user-1' })),
}));

import { errorHandler } from '../middleware/errorHandler';
import { createManagerRoutes } from './managerRoutes';

function app() {
  const a = new Hono();
  a.onError(errorHandler as never);
  a.route('/api/manager', createManagerRoutes({} as never, {} as never, {} as never) as never);
  return a;
}

const put = (body: unknown) => app().request('/api/manager/3', {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}, {});
const patchDefaults = (body: unknown) => app().request('/api/manager/defaults', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}, {});

const projectRow = (o: Partial<ManagerConfigRow> = {}): ManagerConfigRow => ({
  managerRef: null, enabled: true, prMergePolicy: 'immediate', autoAssign: true, autoBusinessValue: true,
  autoPrioritize: true, managerType: 'general', requireSignoffToComplete: false, allowAutoMerge: null, shipMode: null, ...o,
});

beforeEach(() => {
  h.role = 'manager';
  h.project = { ...projectRow() };
  h.tenant = null;
  h.activity.mockClear();
  h.upsertConfig.mockReset().mockImplementation(async (_db: unknown, _t: number, _p: number, patch: Record<string, unknown>) => {
    h.project = { ...h.project, ...patch };
    return h.project;
  });
  h.upsertDefaults.mockReset().mockImplementation(async (_db: unknown, _t: number, patch: Partial<TenantManagerDefaultsRow>) => {
    h.tenant = { ...(h.tenant ?? {}), ...patch };
    return h.tenant;
  });
});

describe('PUT /api/manager/:projectId — shipMode', () => {
  it.each(['leave_uncommitted', 'commit', 'commit_push', 'pull_request'])('accepts %s and returns the derived ship policy', async (mode) => {
    const res = await put({ shipMode: mode });
    expect(res.status).toBe(200);
    expect(h.upsertConfig).toHaveBeenCalledWith(expect.anything(), TENANT, 3, expect.objectContaining({ shipMode: mode }));
    const json = await res.json() as { policy: { shipMode: string }; shipPolicy: { local: { mode: string; source: string }; cloud: { mode: string } } };
    expect(json.policy.shipMode).toBe(mode);
    expect(json.shipPolicy.local).toMatchObject({ mode, source: 'project_settings' });
    // Cloud runs always open a pull request, whatever the local mode.
    expect(json.shipPolicy.cloud.mode).toBe('pull_request');
  });

  it('accepts null as "inherit the workspace default"', async () => {
    h.tenant = { shipMode: 'commit_push' };
    const res = await put({ shipMode: null });
    expect(res.status).toBe(200);
    expect(h.upsertConfig).toHaveBeenCalledWith(expect.anything(), TENANT, 3, expect.objectContaining({ shipMode: null }));
    const json = await res.json() as { shipPolicy: { local: { mode: string } } };
    expect(json.shipPolicy.local.mode).toBe('commit_push');
  });

  it('rejects an unknown mode with a 400 and writes nothing', async () => {
    const res = await put({ shipMode: 'push_to_main' });
    expect(res.status).toBe(400);
    expect(h.upsertConfig).not.toHaveBeenCalled();
  });

  it('leaves the stored mode alone when the field is absent', async () => {
    await put({ autoAssign: false });
    expect(h.upsertConfig.mock.calls[0]![3]).not.toHaveProperty('shipMode');
  });

  it('records the ship mode on the audit timeline', async () => {
    await put({ shipMode: 'commit_push' });
    expect(h.activity).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      verb: 'manager.config.update', summary: expect.stringContaining('ship mode: commit_push'),
    }));
  });
});

describe('PATCH /api/manager/defaults — shipMode', () => {
  it('accepts a workspace default and records it on the audit timeline', async () => {
    const res = await patchDefaults({ shipMode: 'pull_request' });
    expect(res.status).toBe(200);
    expect(h.upsertDefaults).toHaveBeenCalledWith(expect.anything(), TENANT, { shipMode: 'pull_request' }, expect.anything());
    expect(h.activity).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      verb: 'manager.defaults.update', summary: expect.stringContaining('ship mode: pull_request'),
    }));
  });

  it('accepts null to clear the workspace opinion', async () => {
    const res = await patchDefaults({ shipMode: null });
    expect(res.status).toBe(200);
    expect(h.upsertDefaults).toHaveBeenCalledWith(expect.anything(), TENANT, { shipMode: null }, expect.anything());
  });

  it('rejects an unknown mode with a 400', async () => {
    const res = await patchDefaults({ shipMode: 'ship_it' });
    expect(res.status).toBe(400);
    expect(h.upsertDefaults).not.toHaveBeenCalled();
  });
});

describe('the manager-role gate on shipMode', () => {
  it('a DEVELOPER cannot set the project ship mode (403, nothing written)', async () => {
    h.role = 'developer';
    const res = await put({ shipMode: 'commit_push' });
    expect(res.status).toBe(403);
    expect(h.upsertConfig).not.toHaveBeenCalled();
  });

  it('a DEVELOPER cannot set the workspace ship mode (403, nothing written)', async () => {
    h.role = 'developer';
    const res = await patchDefaults({ shipMode: 'commit_push' });
    expect(res.status).toBe(403);
    expect(h.upsertDefaults).not.toHaveBeenCalled();
  });
});
