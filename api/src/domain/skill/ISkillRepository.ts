import { Skill } from './Skill';
import { SkillId, AgentId, TenantId } from '../shared/types';

/**
 * Legacy `skills` rows. Every method is tenant-scoped (`skills.tenant_id`, migration
 * 1351) — there is deliberately no unscoped read or write.
 */
export interface ISkillRepository {
  findById(tenantId: TenantId, id: SkillId): Promise<Skill | null>;
  findAllByAgent(tenantId: TenantId, agentId: AgentId): Promise<Skill[]>;
  /** Every skill on the tenant's agents. */
  findAllByTenant(tenantId: TenantId): Promise<Skill[]>;
  save(tenantId: TenantId, skill: Skill): Promise<Skill>;
}
