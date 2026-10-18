import { Skill } from './Skill';
import { SkillId, AgentId, TenantId } from '../shared/types';

export interface ISkillRepository {
  findById(id: SkillId): Promise<Skill | null>;
  findAllByAgent(agentId: AgentId): Promise<Skill[]>;
  /** Every skill on the tenant's agents. There is deliberately no unscoped list. */
  findAllByTenant(tenantId: TenantId): Promise<Skill[]>;
  save(skill: Skill): Promise<Skill>;
}
