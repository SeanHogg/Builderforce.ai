/**
 * AGENT_ASSIGNMENT_TOOLS — the Brain/MCP twin of /api/agent-assignments. Pins the shared
 * role policy (project / workspace writes need MANAGER+, a role-less run caller is left
 * to its run), scope validation on list, the workspace-is-tenant-wide rule, and that a
 * removal names the target it may remove.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantRole } from '../../domain/shared/types';

const svc = { list: vi.fn(), listForProject: vi.fn(), assign: vi.fn(), find: vi.fn(), unassign: vi.fn() };
vi.mock('../agent/AgentAssignmentService', () => ({
  AgentAssignmentService: class {
    list = svc.list;
    listForProject = svc.listForProject;
    assign = svc.assign;
    find = svc.find;
    unassign = svc.unassign;
  },
}));

const { AGENT_ASSIGNMENT_TOOLS } = await import('./agentAssignmentToolCatalog');

const tool = (name: string) => {
  const t = AGENT_ASSIGNMENT_TOOLS.find((x) => x.tool === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

const getProject = vi.fn(async () => ({ id: 12 }));
const ctx = (role?: TenantRole) => ({ db: {}, env: undefined, tenantId: 3, role, projects: { getProject } }) as never;

describe('agent assignment tools', () => {
  beforeEach(() => {
    for (const fn of Object.values(svc)) fn.mockReset();
    getProject.mockClear();
  });

  it('refuses project staffing to a developer and admits a manager', async () => {
    const args = { projectId: 12, agentKind: 'workforce', agentRef: 'agent-1', name: 'Ada' };
    await expect(tool('project_agents.add').run(ctx(TenantRole.DEVELOPER), args)).rejects.toThrow(/manager/);
    expect(svc.assign).not.toHaveBeenCalled();

    svc.assign.mockResolvedValue({ id: 'a-1' });
    await tool('project_agents.add').run(ctx(TenantRole.MANAGER), args);
    expect(svc.assign).toHaveBeenCalledWith(3, expect.objectContaining({ scope: 'project', scopeId: '12' }));
  });

  it('leaves a role-less (agent/server) caller to its run, as every builtin tool does', async () => {
    svc.assign.mockResolvedValue({ id: 'a-1' });
    await tool('agent_assignments.assign').run(ctx(undefined), { agentKind: 'workforce', agentRef: 'agent-1', scope: 'workspace' });
    expect(svc.assign).toHaveBeenCalled();
  });

  it('keeps non-configurable scopes open to any member', async () => {
    svc.assign.mockResolvedValue({ id: 'a-1' });
    await tool('agent_assignments.assign').run(ctx(TenantRole.DEVELOPER), { agentKind: 'workforce', agentRef: 'agent-1', scope: 'brain' });
    expect(svc.assign).toHaveBeenCalled();
  });

  it('rejects an unroutable scope on list and assign (chat invites are not reachable here)', async () => {
    await expect(tool('agent_assignments.list').run(ctx(TenantRole.MANAGER), { scope: 'chat', scopeId: '7' })).rejects.toThrow(/scope must be one of/);
    await expect(tool('agent_assignments.assign').run(ctx(TenantRole.MANAGER), { agentKind: 'workforce', agentRef: 'x', scope: 'bogus' })).rejects.toThrow(/scope must be one of/);
    expect(svc.list).not.toHaveBeenCalled();
  });

  it('rejects a scopeId on a workspace identity', async () => {
    await expect(tool('agent_assignments.assign').run(ctx(TenantRole.MANAGER), { agentKind: 'workforce', agentRef: 'x', scope: 'workspace', scopeId: '9' })).rejects.toThrow(/tenant-wide/);
    expect(svc.assign).not.toHaveBeenCalled();
  });

  it('removes only a project row through project_agents.remove, naming that target', async () => {
    svc.find.mockResolvedValue({ id: 'a-1', scope: 'project' });
    svc.unassign.mockResolvedValue(true);
    expect(await tool('project_agents.remove').run(ctx(TenantRole.MANAGER), { id: '41' })).toEqual({ deleted: 'a-1' });
    expect(svc.unassign).toHaveBeenCalledWith(3, 'a-1', { scope: 'project' });
  });

  it('gates agent_assignments.remove on the row scope and never removes a chat invite', async () => {
    svc.find.mockResolvedValueOnce({ id: 'a-1', scope: 'project' });
    await expect(tool('agent_assignments.remove').run(ctx(TenantRole.DEVELOPER), { id: 'a-1' })).rejects.toThrow(/manager/);

    svc.find.mockResolvedValueOnce({ id: 'c-1', scope: 'chat' });
    expect(await tool('agent_assignments.remove').run(ctx(TenantRole.MANAGER), { id: 'c-1' })).toEqual({ deleted: null });
    expect(svc.unassign).not.toHaveBeenCalled();
  });
});
