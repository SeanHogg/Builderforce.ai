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

  async listSkills(agentId?: number): Promise<Skill[]> {
    if (agentId !== undefined) {
      return this.skills.findAllByAgent(asAgentId(agentId));
    }
    return this.skills.findAll();
  }

}
