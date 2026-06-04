import { IAgentHostRepository } from '../../domain/agentHost/IAgentHostRepository';
import type { AgentHost, AgentHostStatus } from '../../domain/agentHost/AgentHost';
import { asAgentHostId, asTenantId } from '../../domain/shared/types';

export type AgentHostFilterStatus = 'online' | 'offline' | null;

export class AgentHostService {
  constructor(private readonly agentHostRepo: IAgentHostRepository) {}

  async getAgentHostForTenant(agentHostId: number, tenantId: number): Promise<AgentHost | null> {
    return this.agentHostRepo.findByIdAndTenant(asAgentHostId(agentHostId), asTenantId(tenantId));
  }

  async listAgentHostsForTenant(tenantId: number, status: AgentHostFilterStatus = null): Promise<AgentHost[]> {
    const agentHosts = await this.agentHostRepo.findByTenant(asTenantId(tenantId));
    if (status === 'online') {
      return agentHosts.filter((c) => c.connectedAt !== null);
    }
    if (status === 'offline') {
      return agentHosts.filter((c) => c.connectedAt === null);
    }
    return agentHosts;
  }

  async updateDeclaredCapabilities(agentHostId: number, tenantId: number, capabilities: string[]): Promise<AgentHost | null> {
    const agentHost = await this.getAgentHostForTenant(agentHostId, tenantId);
    if (!agentHost) return null;

    // Currently our repository does not support updates, so we defer to callers.
    // This method exists to encapsulate business rules in the future.
    return agentHost;
  }

  async verifyApiKey(agentHostId: number, apiKey: string): Promise<AgentHost | null> {
    return this.agentHostRepo.verifyApiKey(asAgentHostId(agentHostId), apiKey);
  }

  async setStatus(agentHostId: number, tenantId: number, status: AgentHostStatus): Promise<AgentHost | null> {
    return this.agentHostRepo.updateStatus(asAgentHostId(agentHostId), asTenantId(tenantId), status);
  }

  async deactivate(agentHostId: number, tenantId: number): Promise<AgentHost | null> {
    return this.setStatus(agentHostId, tenantId, 'inactive');
  }
}
