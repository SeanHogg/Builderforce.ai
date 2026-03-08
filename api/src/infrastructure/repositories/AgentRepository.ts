import { eq } from 'drizzle-orm';
import { IAgentRepository } from '../../domain/agent/IAgentRepository';
import { Agent, AgentProps } from '../../domain/agent/Agent';
import { AgentId, TenantId, AgentType, asAgentId, asTenantId } from '../../domain/shared/types';
import { agents as agentsTable } from '../database/schema';
import type { Db } from '../database/connection';

export class AgentRepository implements IAgentRepository {
  constructor(private readonly db: Db) {}

  async findById(id: AgentId): Promise<Agent | null> {
    const [row] = await this.db
      .select().from(agentsTable)
      .where(eq(agentsTable.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  async findAllByTenant(tenantId: TenantId): Promise<Agent[]> {
    const rows = await this.db
      .select().from(agentsTable)
      .where(eq(agentsTable.tenantId, tenantId));
    return rows.map(toDomain);
  }

  async save(agent: Agent): Promise<Agent> {
    const plain = agent.toPlain();
    const [inserted] = await this.db
      .insert(agentsTable)
      .values({
        tenantId:   plain.tenantId,
        name:       plain.name,
        type:       plain.type,
        endpoint:   plain.endpoint,
        apiKeyHash: plain.apiKeyHash ?? undefined,
        isActive:   plain.isActive,
        config:     plain.config ?? undefined,
      })
      .returning();
    if (!inserted) throw new Error('Agent insert returned no rows');
    return toDomain(inserted);
  }

  async update(agent: Agent): Promise<Agent> {
    const plain = agent.toPlain();
    const [updated] = await this.db
      .update(agentsTable)
      .set({
        name:      plain.name,
        endpoint:  plain.endpoint,
        isActive:  plain.isActive,
        config:    plain.config ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(agentsTable.id, plain.id))
      .returning();
    if (!updated) throw new Error('Agent update returned no rows');
    return toDomain(updated);
  }
}

function toDomain(row: typeof agentsTable.$inferSelect): Agent {
  return Agent.reconstitute({
    id:         asAgentId(row.id),
    tenantId:   asTenantId(row.tenantId),
    name:       row.name,
    type:       row.type as AgentType,
    endpoint:   row.endpoint,
    apiKeyHash: row.apiKeyHash ?? null,
    isActive:   row.isActive,
    config:     row.config ?? null,
    createdAt:  row.createdAt,
    updatedAt:  row.updatedAt,
  } as AgentProps);
}
