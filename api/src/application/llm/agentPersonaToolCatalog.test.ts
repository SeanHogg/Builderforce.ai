import { beforeEach, describe, expect, it, vi } from 'vitest';

const staffUnfilledRole = vi.fn();
const resolveAgentPersonaBrief = vi.fn();
vi.mock('../manager/staffUnfilledRole', () => ({ staffUnfilledRole: (...a: unknown[]) => staffUnfilledRole(...a) }));
vi.mock('../agent/agentPersonaBrief', () => ({
  resolveAgentPersonaBrief: (...a: unknown[]) => resolveAgentPersonaBrief(...a),
  listTenantAgentNames: vi.fn(async () => []),
  listTenantAgentsForRole: vi.fn(async () => []),
}));

import { AGENT_PERSONA_TOOLS } from './agentPersonaToolCatalog';
import type { BuiltinCtx } from './builtinToolContext';

const staffRole = AGENT_PERSONA_TOOLS.find((t) => t.tool === 'cloud_agents.staff_role')!;

function ctx() {
  const getProject = vi.fn(async () => ({ id: 11 }));
  const getTask = vi.fn(async (id: number) => ({ id, projectId: 11 }));
  const updateTask = vi.fn(async () => ({}));
  const c = {
    db: {},
    tenantId: 1,
    env: {},
    projects: { getProject },
    tasks: { getTask, updateTask },
  } as unknown as BuiltinCtx;
  return { c, getProject, updateTask };
}

describe('cloud_agents.staff_role', () => {
  beforeEach(() => {
    staffUnfilledRole.mockReset();
    resolveAgentPersonaBrief.mockReset();
  });

  it('staffs the role on the caller\'s project in the caller\'s tenant, hires when needed, and assigns the tickets', async () => {
    staffUnfilledRole.mockResolvedValue({ action: 'hired', roleKey: 'developer', agentRef: 'manager-hired-developer-t1', agentName: 'Developer', detail: 'hired' });
    resolveAgentPersonaBrief.mockResolvedValue({ agentRef: 'manager-hired-developer-t1', name: 'Developer', title: 'Developer', roleKeys: ['developer'], brief: 'b' });
    const { c, getProject, updateTask } = ctx();

    const out = await staffRole.run(c, { role: 'developer', projectId: 11, taskIds: [2861] }) as Record<string, unknown>;

    // Tenant guard on the project, then the ONE staffing ladder scoped to tenant + project.
    expect(getProject).toHaveBeenCalledWith(11, 1);
    expect(staffUnfilledRole).toHaveBeenCalledWith(c.env, c.db, { tenantId: 1, projectId: 11, roleKey: 'developer' });
    expect(out).toMatchObject({ ok: true, agentRef: 'manager-hired-developer-t1', created: true, assigned: [2861] });
    // Assigned through the task service — never `tasks.update`, which would start a cloud run.
    expect(updateTask).toHaveBeenCalledWith(2861, { assignedAgentRef: 'manager-hired-developer-t1' });
  });

  it('requires a project', async () => {
    const { c } = ctx();
    const out = await staffRole.run(c, { role: 'developer' }) as Record<string, unknown>;
    expect(out.ok).toBe(false);
    expect(staffUnfilledRole).not.toHaveBeenCalled();
  });

  it('reports the ladder\'s refusal instead of inventing an agent', async () => {
    staffUnfilledRole.mockResolvedValue({ action: 'escalate', roleKey: 'nonsense', agentRef: null, agentName: null, detail: 'not a role this workspace recognises' });
    const { c } = ctx();
    const out = await staffRole.run(c, { role: 'nonsense', projectId: 11 }) as Record<string, unknown>;
    expect(out).toMatchObject({ ok: false, error: 'not a role this workspace recognises' });
  });
});
