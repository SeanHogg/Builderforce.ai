import { AgentHost, AgentHostStatus } from './AgentHost';
import { AgentHostId, TenantId } from '../shared/types';

export interface IAgentHostRepository {
  findById(id: AgentHostId): Promise<AgentHost | null>;
  findByIdAndTenant(id: AgentHostId, tenantId: TenantId): Promise<AgentHost | null>;
  findByTenant(tenantId: TenantId): Promise<AgentHost[]>;
  verifyApiKey(id: AgentHostId, apiKey: string): Promise<AgentHost | null>;
  updateStatus(id: AgentHostId, tenantId: TenantId, status: AgentHostStatus): Promise<AgentHost | null>;
}
