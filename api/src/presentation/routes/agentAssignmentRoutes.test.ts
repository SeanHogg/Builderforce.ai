/**
 * /api/agent-assignments — the ONE assignment router, and `/api/project-agents` as its
 * deprecated alias (migration 1265 folded `project_agents` into `agent_assignments`).
 * Pins the legacy project-agents contract the alias still answers, the deprecation
 * headers and status codes, the MANAGER gate on project staffing, the chat-invite
 * refusal, workspace identities staying tenant-wide, and the adder for non-user callers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

let role = 'manager';
let machine = false;
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('tenantId', 3);
    c.set('userId', 'u-1');
    c.set('role', role);
    await next();
  },
  requestActor: (c: { get: (k: string) => unknown }) =>
    (machine ? { actorAgentHostId: 5 } : { actorUserId: c.get('userId') ?? null }),
}));

const svc = { list: vi.fn(), assign: vi.fn(), find: vi.fn(), unassign: vi.fn(), setGovernance: vi.fn() };
vi.mock('../../application/agent/AgentAssignmentService', () => ({
  AgentAssignmentService: class {
    list = svc.list;
    assign = svc.assign;
    find = svc.find;
    unassign = svc.unassign;
    setGovernance = svc.setGovernance;
  },
}));
vi.mock('../../application/project/projectOwnership', () => ({
  projectInTenant: async (_db: unknown, _t: number, projectId: number) => projectId === 12,
  projectInTenantCached: async (_env: unknown, _db: unknown, _t: number, projectId: number) => projectId === 12,
}));

const { createAgentAssignmentRoutes } = await import('./agentAssignmentRoutes');
const { mountWithLegacyAliases, AGENT_ASSIGNMENT_BASE_PATH, LEGACY_AGENT_ASSIGNMENT_PATHS } = await import('../middleware/legacyAlias');
const { ForbiddenError } = await import('../../domain/shared/errors');

function app() {
  const a = new Hono();
  a.onError((err, c) => c.json({ error: err.message }, err instanceof ForbiddenError ? 403 : 500));
  mountWithLegacyAliases(a as never, AGENT_ASSIGNMENT_BASE_PATH, LEGACY_AGENT_ASSIGNMENT_PATHS, () => createAgentAssignmentRoutes({} as never));
  return a;
}

const staffed = {
  id: 'a-1', agentHandle: 41, agentKind: 'workforce', agentRef: 'agent-1', scope: 'project', scopeId: '12',
  projectId: 12, executionScope: 'project', role: 'default', name: 'Ada', governance: null, addedBy: 'u-1',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('agent assignment routes', () => {
  beforeEach(() => {
    role = 'manager';
    machine = false;
    for (const fn of Object.values(svc)) fn.mockReset();
  });

  it('answers the legacy ?projectId= list with the old row shape (id = handle) and deprecation headers', async () => {
    svc.list.mockResolvedValue([staffed]);
    const res = await app().request('/api/project-agents?projectId=12');
    expect(res.status).toBe(200);
    expect(res.headers.get('Deprecation')).toBe('true');
    expect(res.headers.get('Link')).toBe('</api/agent-assignments>; rel="successor-version"');
    expect(svc.list).toHaveBeenCalledWith(3, 'project', '12');
    const body = await res.json() as { agents: Array<Record<string, unknown>> };
    expect(body.agents[0]).toMatchObject({ id: 41, assignmentId: 'a-1', projectId: 12, name: 'Ada', tenantId: 3 });
  });

  it('serves the canonical scope list without legacy keys or deprecation headers', async () => {
    svc.list.mockResolvedValue([staffed]);
    const res = await app().request('/api/agent-assignments?scope=project&scopeId=12');
    expect(res.headers.get('Deprecation')).toBeNull();
    expect(await res.json()).toEqual({ assignments: [staffed] });
  });

  it('404s a project outside the tenant', async () => {
    const res = await app().request('/api/agent-assignments?scope=project&scopeId=77');
    expect(res.status).toBe(404);
    expect(svc.list).not.toHaveBeenCalled();
  });

  it('turns the legacy attach body into a project-scope assignment that leaves an existing one untouched (200)', async () => {
    svc.assign.mockResolvedValue(staffed);
    const res = await app().request('/api/project-agents', json({ projectId: 12, agentKind: 'workforce', agentRef: 'agent-1', name: 'Ada' }));
    expect(res.status).toBe(200);
    expect(svc.assign).toHaveBeenCalledWith(3, expect.objectContaining({
      scope: 'project', scopeId: '12', agentKind: 'workforce', agentRef: 'agent-1', name: 'Ada', addedBy: 'u-1', onExisting: 'keep',
    }));
    expect(await res.json()).toMatchObject({ assignment: { id: 'a-1' }, agent: { id: 41 } });
  });

  it('keeps project staffing a MANAGER+ act', async () => {
    role = 'developer';
    const res = await app().request('/api/agent-assignments', json({ scope: 'project', scopeId: '12', agentKind: 'workforce', agentRef: 'agent-1' }));
    expect(res.status).toBe(403);
    expect(svc.assign).not.toHaveBeenCalled();
  });

  it('leaves the other scopes open to any member', async () => {
    role = 'developer';
    svc.assign.mockResolvedValue({ ...staffed, scope: 'brain', scopeId: null, projectId: null });
    const res = await app().request('/api/agent-assignments', json({ scope: 'brain', agentKind: 'workforce', agentRef: 'agent-1' }));
    expect(res.status).toBe(201);
  });

  it('detaches by the legacy numeric id through the same unassign, answering 204', async () => {
    svc.find.mockResolvedValue(staffed);
    svc.unassign.mockResolvedValue(true);
    const res = await app().request('/api/project-agents/41', { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(svc.find).toHaveBeenCalledWith(3, '41');
    expect(svc.unassign).toHaveBeenCalledWith(3, 'a-1', { scope: ['project', 'workspace'] });
  });

  it('never removes a chat invite by id — that goes through the chat routes', async () => {
    svc.find.mockResolvedValue({ ...staffed, scope: 'chat', scopeId: '7', projectId: null });
    const res = await app().request('/api/agent-assignments/a-1', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(svc.unassign).not.toHaveBeenCalled();
  });

  it('rejects a scopeId on a workspace identity', async () => {
    const res = await app().request('/api/agent-assignments', json({ scope: 'workspace', scopeId: '9', agentKind: 'workforce', agentRef: 'agent-1' }));
    expect(res.status).toBe(400);
    expect(svc.assign).not.toHaveBeenCalled();
  });

  it('records no adder for a machine principal (its subject is not a users.id)', async () => {
    machine = true;
    svc.assign.mockResolvedValue(staffed);
    await app().request('/api/agent-assignments', json({ scope: 'project', scopeId: '012', agentKind: 'workforce', agentRef: 'agent-1' }));
    expect(svc.assign).toHaveBeenCalledWith(3, expect.objectContaining({ addedBy: null, scopeId: '12' }));
  });

  it('sets per-agent governance on a staffed agent only', async () => {
    svc.find.mockResolvedValueOnce({ ...staffed, scope: 'brain' });
    const refused = await app().request('/api/agent-assignments/a-9/governance', { ...json({ governance: 'x' }), method: 'PUT' });
    expect(refused.status).toBe(404);

    svc.find.mockResolvedValueOnce(staffed);
    svc.setGovernance.mockResolvedValue({ ...staffed, governance: 'Be terse.' });
    const res = await app().request('/api/agent-assignments/a-1/governance', { ...json({ governance: 'Be terse.' }), method: 'PUT' });
    expect(res.status).toBe(200);
    expect(svc.setGovernance).toHaveBeenCalledWith(3, 'a-1', 'Be terse.');
  });
});
