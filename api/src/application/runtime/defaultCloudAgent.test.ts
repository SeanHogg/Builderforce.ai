/**
 * WHO an Auto/default run executes AS.
 *
 * The bug this closes is invisible rather than loud: a run with no payload pin and no
 * ticket assignee resolved to no agent at all, so it executed, wrote code and opened a
 * PR with `executions.cloud_agent_ref` NULL — indistinguishable on the board from a run
 * that never happened. What these pin is the ORDER of the two existing resolutions and,
 * just as importantly, that "nobody" produces a TYPED reason rather than silence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const recommendTopAssignee = vi.fn();
const resolveRoleCapableAgents = vi.fn();
const producerRoleForActionType = vi.fn();

vi.mock('../metrics/assigneeRecommender', () => ({
  recommendTopAssignee: (...a: unknown[]) => recommendTopAssignee(...a),
}));
vi.mock('../kanban/roleCapability', () => ({
  resolveRoleCapableAgents: (...a: unknown[]) => resolveRoleCapableAgents(...a),
  producerRoleForActionType: (...a: unknown[]) => producerRoleForActionType(...a),
}));

const { resolveDefaultCloudAgentRef, UNATTRIBUTED_RUN_MESSAGE } = await import('./defaultCloudAgent');

/** A minimal drizzle chain that answers the one action-type lookup. */
const dbWith = (actionType: string | null) => ({
  select: () => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({ limit: async () => (actionType === undefined ? [] : [{ actionType }]) }),
      }),
    }),
  }),
}) as never;

const env = {} as never;
const ARGS = { tenantId: 1, projectId: 2, taskId: 7 };

describe('resolveDefaultCloudAgentRef', () => {
  beforeEach(() => {
    recommendTopAssignee.mockReset();
    resolveRoleCapableAgents.mockReset();
    producerRoleForActionType.mockReset().mockReturnValue('developer');
  });

  it('prefers the availability-aware recommender — the same pick a manual assignment makes', async () => {
    recommendTopAssignee.mockResolvedValue({ memberKind: 'cloud_agent', memberRef: 'agent-a' });
    const r = await resolveDefaultCloudAgentRef(env, dbWith('backend_api'), ARGS);
    expect(r).toEqual({ ref: 'agent-a', via: 'recommender', roleKey: 'developer' });
    // Tier 2 is not even consulted when tier 1 answers.
    expect(resolveRoleCapableAgents).not.toHaveBeenCalled();
  });

  it("constrains the recommender to the role the WORK implies, agents only", async () => {
    producerRoleForActionType.mockReturnValue('qa-tester');
    recommendTopAssignee.mockResolvedValue({ memberKind: 'cloud_agent', memberRef: 'qa-1' });
    await resolveDefaultCloudAgentRef(env, dbWith('tests'), ARGS);
    expect(recommendTopAssignee).toHaveBeenCalledWith(env, expect.anything(), 2, { agentOnly: true, roleKey: 'qa-tester' });
  });

  it('falls through to the capability oracle when the recommender returns nobody', async () => {
    // The common case for a new workspace: the recommender is scoped to the project's
    // TEAMS, and a project with no team attached yields no agent at all.
    recommendTopAssignee.mockResolvedValue(null);
    resolveRoleCapableAgents.mockResolvedValue([{ kind: 'agent', ref: 'agent-b', name: 'Bee', via: 'builtin-kind' }]);
    const r = await resolveDefaultCloudAgentRef(env, dbWith('backend_api'), ARGS);
    expect(r).toEqual({ ref: 'agent-b', via: 'role-oracle', roleKey: 'developer' });
  });

  it('does NOT accept a host agent as a cloud identity — it falls through instead', async () => {
    recommendTopAssignee.mockResolvedValue({ memberKind: 'host_agent', memberRef: '12' });
    resolveRoleCapableAgents.mockResolvedValue([{ kind: 'agent', ref: 'agent-c', name: 'Cee', via: 'role-keys' }]);
    const r = await resolveDefaultCloudAgentRef(env, dbWith('refactor'), ARGS);
    expect(r).toEqual({ ref: 'agent-c', via: 'role-oracle', roleKey: 'developer' });
  });

  it("asks the oracle for 'developer' when the ticket carries no action type", async () => {
    producerRoleForActionType.mockReturnValue(undefined);
    recommendTopAssignee.mockResolvedValue(null);
    resolveRoleCapableAgents.mockResolvedValue([]);
    const r = await resolveDefaultCloudAgentRef(env, dbWith(null), ARGS);
    expect(recommendTopAssignee).toHaveBeenCalledWith(env, expect.anything(), 2, { agentOnly: true });
    expect(resolveRoleCapableAgents).toHaveBeenCalledWith(env, expect.anything(), 1, 2, 'developer');
    expect(r).toEqual({ ref: null, reason: 'no_capable_cloud_agent', roleKey: null });
  });

  it('reports a TYPED reason when the workspace has nobody — never a silent anonymous run', async () => {
    recommendTopAssignee.mockResolvedValue(null);
    resolveRoleCapableAgents.mockResolvedValue([]);
    const r = await resolveDefaultCloudAgentRef(env, dbWith('bugfix'), ARGS);
    expect(r).toEqual({ ref: null, reason: 'no_capable_cloud_agent', roleKey: 'developer' });
    if (r.ref !== null) return;
    // The reason has to resolve to something a human can act on.
    expect(UNATTRIBUTED_RUN_MESSAGE[r.reason]).toMatch(/Workforce/);
  });

  it('a thrown lookup degrades to a DISTINCT reason, never to a crashed dispatch', async () => {
    recommendTopAssignee.mockRejectedValue(new Error('db down'));
    const r = await resolveDefaultCloudAgentRef(env, dbWith('backend_api'), ARGS);
    expect(r).toEqual({ ref: null, reason: 'agent_resolution_failed', roleKey: 'developer' });
    // Distinct from "nobody exists": one is a roster gap, the other is an outage.
    expect(UNATTRIBUTED_RUN_MESSAGE.agent_resolution_failed)
      .not.toBe(UNATTRIBUTED_RUN_MESSAGE.no_capable_cloud_agent);
  });
});
