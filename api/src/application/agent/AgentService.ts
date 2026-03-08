import { IAgentRepository } from '../../domain/agent/IAgentRepository';
import { ISkillRepository } from '../../domain/skill/ISkillRepository';
import { Agent } from '../../domain/agent/Agent';
import { Skill } from '../../domain/skill/Skill';
import { AgentType, TenantId, AgentId, asTenantId, asAgentId } from '../../domain/shared/types';
import { NotFoundError } from '../../domain/shared/errors';
import { hashSecret } from '../../infrastructure/auth/HashService';
import { AuditEventType } from '../../domain/shared/types';
import { IAuditRepository } from '../../domain/audit/IAuditRepository';
import { AuditEvent } from '../../domain/audit/AuditEvent';

export interface RegisterAgentDto {
  tenantId:   number;
  name:       string;
  type:       AgentType;
  endpoint:   string;
  apiKey?:    string;   // plaintext – will be hashed
  config?:    string;
  submittedBy: string;
}

export interface RegisterSkillDto {
  agentId:      number;
  name:         string;
  description?: string;
  inputSchema?: string;
  outputSchema?: string;
}

export class AgentService {
  constructor(
    private readonly agents: IAgentRepository,
    private readonly skills: ISkillRepository,
    private readonly audit:  IAuditRepository,
  ) {}

  async listAgents(tenantId: number): Promise<Agent[]> {
    return this.agents.findAllByTenant(asTenantId(tenantId));
  }

  async getAgent(id: number): Promise<Agent> {
    const agent = await this.agents.findById(asAgentId(id));
    if (!agent) throw new NotFoundError('Agent', id);
    return agent;
  }

  async registerAgent(dto: RegisterAgentDto): Promise<Agent> {
    const apiKeyHash = dto.apiKey ? await hashSecret(dto.apiKey) : null;

    const agent = await this.agents.save(Agent.create({
      tenantId:   asTenantId(dto.tenantId),
      name:       dto.name,
      type:       dto.type,
      endpoint:   dto.endpoint,
      apiKeyHash,
      isActive:   true,
      config:     dto.config ?? null,
    }));

    await this.audit.save(AuditEvent.create({
      tenantId:     asTenantId(dto.tenantId),
      userId:       dto.submittedBy,
      eventType:    AuditEventType.AGENT_REGISTERED,
      resourceType: 'agent',
      resourceId:   String(agent.id),
      metadata:     null,
    }));

    return agent;
  }

  async deactivateAgent(id: number): Promise<Agent> {
    const agent = await this.getAgent(id);
    return this.agents.update(agent.deactivate());
  }

  async listSkills(agentId?: number): Promise<Skill[]> {
    if (agentId !== undefined) {
      return this.skills.findAllByAgent(asAgentId(agentId));
    }
    return this.skills.findAll();
  }

  async registerSkill(dto: RegisterSkillDto): Promise<Skill> {
    await this.getAgent(dto.agentId); // guard – agent must exist
    return this.skills.save(Skill.create({
      agentId:      asAgentId(dto.agentId),
      name:         dto.name,
      description:  dto.description ?? null,
      inputSchema:  dto.inputSchema ?? null,
      outputSchema: dto.outputSchema ?? null,
    }));
  }
}
