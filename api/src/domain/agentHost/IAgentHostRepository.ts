import { AgentHost, AgentHostStatus } from './AgentHost';
import { AgentHostId, TenantId } from '../shared/types';
import type { Env } from '../../env';

export interface IAgentHostRepository {
  findById(id: AgentHostId): Promise<AgentHost | null>;
  findByIdAndTenant(id: AgentHostId, tenantId: TenantId): Promise<AgentHost | null>;
  findByTenant(tenantId: TenantId): Promise<AgentHost[]>;
  verifyApiKey(id: AgentHostId, apiKey: string): Promise<AgentHost | null>;
  /**
   * Transition lifecycle status. `env` is threaded in so the long-TTL `clk_*`
   * auth cache is invalidated AT THE MUTATION — a non-active status must stop the
   * key working immediately, and no caller can forget to invalidate.
   */
  updateStatus(id: AgentHostId, tenantId: TenantId, status: AgentHostStatus, env: Env): Promise<AgentHost | null>;
}
