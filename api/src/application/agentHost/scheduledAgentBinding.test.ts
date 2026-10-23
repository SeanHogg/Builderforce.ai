/**
 * resolveScheduledAgentBinding — a schedule's "run AS this agent" now names an agent
 * assignment's integer handle (migration 1265 folded `project_agents` into
 * `agent_assignments`, keeping each old id as the handle). Pins which assignments a
 * schedule may run as and the project-coherence rule.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const find = vi.fn();
vi.mock('../agent/AgentAssignmentService', () => ({
  AgentAssignmentService: class {
    find = find;
  },
}));

const { resolveScheduledAgentBinding } = await import('./scheduledAgentBinding');

/** No host↔project attachments, so step 1 never refuses. */
const db = {
  select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
} as never;

const base = { tenantId: 3, agentHostId: 5, projectId: 12 };

describe('resolveScheduledAgentBinding', () => {
  beforeEach(() => find.mockReset());

  it('binds a project-staffed agent of the same project by its handle', async () => {
    find.mockResolvedValue({ scope: 'project', projectId: 12, agentHandle: 41, agentKind: 'workforce', agentRef: 'agent-1' });
    const out = await resolveScheduledAgentBinding(db, { ...base, projectAgentId: 41 });
    expect(find).toHaveBeenCalledWith(3, '41');
    expect(out).toEqual({ ok: true, projectAgentId: 41, agentKind: 'workforce', agentRef: 'agent-1' });
  });

  it('accepts the agent workspace identity — the same agent, not pinned to a project', async () => {
    find.mockResolvedValue({ scope: 'workspace', projectId: null, agentHandle: 7, agentKind: 'workforce', agentRef: 'agent-1' });
    const out = await resolveScheduledAgentBinding(db, { ...base, projectAgentId: 7 });
    expect(out).toMatchObject({ ok: true, projectAgentId: 7 });
  });

  it('refuses an agent staffed on a different project', async () => {
    find.mockResolvedValue({ scope: 'project', projectId: 99, agentHandle: 41, agentKind: 'workforce', agentRef: 'agent-1' });
    const out = await resolveScheduledAgentBinding(db, { ...base, projectAgentId: 41 });
    expect(out).toMatchObject({ ok: false, problem: 'agent_project_mismatch' });
  });

  it('refuses a handle that names a lane or chat assignment, not an agent a schedule can run as', async () => {
    find.mockResolvedValue({ scope: 'swimlane', projectId: null, agentHandle: 8, agentKind: 'workforce', agentRef: 'agent-1' });
    const out = await resolveScheduledAgentBinding(db, { ...base, projectAgentId: 8 });
    expect(out).toMatchObject({ ok: false, problem: 'agent_not_found' });
  });

  it('refuses an unknown handle', async () => {
    find.mockResolvedValue(null);
    const out = await resolveScheduledAgentBinding(db, { ...base, projectAgentId: 404 });
    expect(out).toMatchObject({ ok: false, problem: 'agent_not_found' });
  });

  it('leaves a project-wide schedule alone', async () => {
    const out = await resolveScheduledAgentBinding(db, { ...base, projectAgentId: null });
    expect(out).toEqual({ ok: true, projectAgentId: null, agentKind: null, agentRef: null });
    expect(find).not.toHaveBeenCalled();
  });
});
