import { and, eq } from 'drizzle-orm';
import { IAgentHostRepository } from '../../domain/agentHost/IAgentHostRepository';
import { AgentHost, AgentHostStatus } from '../../domain/agentHost/AgentHost';
import { asAgentHostId, asTenantId, AgentHostId, TenantId } from '../../domain/shared/types';
import { agentHosts } from '../database/schema';
import type { Db } from '../database/connection';
import type { Env } from '../../env';
import { verifySecret } from '../auth/HashService';
import { invalidateAgentHostKeyCache } from '../auth/keyResolutionCache';

export class AgentHostRepository implements IAgentHostRepository {
  constructor(private readonly db: Db) {}

  async findById(id: AgentHostId): Promise<AgentHost | null> {
    const [row] = await (this.db
      .select()
      .from(agentHosts) as any)
      .where(eq(agentHosts.id, id))
      .limit(1);
    return row ? this.toDomain(row) : null;
  }

  async findByIdAndTenant(id: AgentHostId, tenantId: TenantId): Promise<AgentHost | null> {
    const [row] = await (this.db
      .select()
      .from(agentHosts) as any)
      .where(and(eq(agentHosts.id, id), eq(agentHosts.tenantId, tenantId)))
      .limit(1);
    return row ? this.toDomain(row) : null;
  }

  async findByTenant(tenantId: TenantId): Promise<AgentHost[]> {
    const rows = await (this.db
      .select()
      .from(agentHosts) as any)
      .where(eq(agentHosts.tenantId, tenantId));
    return rows.map((r: unknown) => this.toDomain(r));
  }

  async verifyApiKey(id: AgentHostId, apiKey: string): Promise<AgentHost | null> {
    const [row] = await this.db
      .select()
      .from(agentHosts)
      .where(eq(agentHosts.id, id))
      .limit(1);
    if (!row) return null;
    const valid = await verifySecret(apiKey, row.apiKeyHash ?? '');
    return valid ? this.toDomain(row) : null;
  }

  async updateStatus(id: AgentHostId, tenantId: TenantId, status: AgentHostStatus, env: Env): Promise<AgentHost | null> {
    const [row] = await this.db
      .update(agentHosts)
      .set({
        status,
      })
      .where(and(eq(agentHosts.id, id), eq(agentHosts.tenantId, tenantId)))
      .returning();
    if (!row) return null;
    // Self-invalidate the long-TTL auth cache so a deactivated/suspended key
    // stops resolving immediately, instead of relying on every caller to remember.
    await invalidateAgentHostKeyCache(env, row.apiKeyHash ?? null);
    return this.toDomain(row);
  }

  private toDomain(row: any): AgentHost {
    return AgentHost.reconstitute({
      id: asAgentHostId(row.id),
      tenantId: asTenantId(row.tenantId),
      name: row.name,
      slug: row.slug,
      status: row.status,
      apiKeyHash: row.apiKeyHash ?? null,
      capabilities: row.capabilities ? (JSON.parse(row.capabilities) as string[]) : null,
      declaredCapabilities: row.declaredCapabilities ? (JSON.parse(row.declaredCapabilities) as string[]) : null,
      connectedAt: row.connectedAt ?? null,
      lastSeenAt: row.lastSeenAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
