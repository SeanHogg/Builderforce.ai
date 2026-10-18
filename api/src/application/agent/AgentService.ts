import { IAgentRepository } from '../../domain/agent/IAgentRepository';
import { ISkillRepository } from '../../domain/skill/ISkillRepository';
import { Agent } from '../../domain/agent/Agent';
import { Skill } from '../../domain/skill/Skill';
import { asTenantId, asAgentId } from '../../domain/shared/types';
import { NotFoundError } from '../../domain/shared/errors';

export class AgentService {
  constructor(
    private readonly agents: IAgentRepository,
    private readonly skills: ISkillRepository,
  ) {}

  async listAgents(tenantId: number): Promise<Agent[]> {
    return this.agents.findAllByTenant(asTenantId(tenantId));
  }

  async getAgent(id: number, tenantId: number): Promise<Agent> {
    // Tenant-scoped: an agent id from another workspace resolves to null → 404,
    // never leaking (or acting on) a cross-tenant agent.
    const agent = await this.agents.findByIdAndTenant(asAgentId(id), asTenantId(tenantId));
    if (!agent) throw new NotFoundError('Agent', id);
    return agent;
  }

  async deactivateAgent(id: number, tenantId: number): Promise<Agent> {
    const agent = await this.getAgent(id, tenantId);
    return this.agents.update(agent.deactivate());
  }

  /**
   * Legacy skills, always tenant-scoped. With an agent id the agent must belong
   * to the tenant (404 otherwise); without one, every skill on the tenant's agents.
   * The unscoped variant `/api/skills` used to call returned every workspace's rows.
   */
  async listSkills(tenantId: number, agentId?: number): Promise<Skill[]> {
    if (agentId !== undefined) {
      await this.getAgent(agentId, tenantId);
      return this.skills.findAllByAgent(asAgentId(agentId));
    }
    return this.skills.findAllByTenant(asTenantId(tenantId));
  }

}
