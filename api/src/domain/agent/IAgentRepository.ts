import { Agent } from './Agent';
import { AgentId, TenantId } from '../shared/types';

export interface IAgentRepository {
  findById(id: AgentId): Promise<Agent | null>;
  findAllByTenant(tenantId: TenantId): Promise<Agent[]>;
  save(agent: Agent): Promise<Agent>;
  update(agent: Agent): Promise<Agent>;
}
