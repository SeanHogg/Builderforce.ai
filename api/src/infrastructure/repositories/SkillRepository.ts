import { eq } from 'drizzle-orm';
import { ISkillRepository } from '../../domain/skill/ISkillRepository';
import { Skill, SkillProps } from '../../domain/skill/Skill';
import { SkillId, AgentId, TenantId, asSkillId, asAgentId } from '../../domain/shared/types';
import { skills as skillsTable } from '../database/schema';
import { scopedToTenant } from '../database/tenantScope';
import type { Db } from '../database/connection';

/**
 * Legacy `skills` rows, owned through `agent_registration_id` (backfilled in
 * migration 1347) and scoped by `tenant_id` (migration 1351). `agent_id` remains a
 * plain integer compatibility reference — its FK was dropped in 1347 — and is what
 * the legacy `/api/skills` projection exposes. Every query is tenant-scoped.
 */
export class SkillRepository implements ISkillRepository {
  constructor(private readonly db: Db) {}

  async findById(tenantId: TenantId, id: SkillId): Promise<Skill | null> {
    const [row] = await this.db
      .select().from(skillsTable)
      .where(scopedToTenant(skillsTable, tenantId, eq(skillsTable.id, id))).limit(1);
    return row ? toDomain(row) : null;
  }

  /** Every skill on the tenant. */
  async findAllByTenant(tenantId: TenantId): Promise<Skill[]> {
    const rows = await this.db
      .select().from(skillsTable)
      .where(scopedToTenant(skillsTable, tenantId));
    return rows.map(toDomain);
  }

  /** Every skill owned by one of the tenant's agents (its legacy `agent_id` compatibility reference). */
  async findAllByAgent(tenantId: TenantId, agentId: AgentId): Promise<Skill[]> {
    const rows = await this.db
      .select().from(skillsTable)
      .where(scopedToTenant(skillsTable, tenantId, eq(skillsTable.agentId, agentId)));
    return rows.map(toDomain);
  }

  async save(tenantId: TenantId, skill: Skill): Promise<Skill> {
    const plain = skill.toPlain();
    const [inserted] = await this.db
      .insert(skillsTable)
      .values({
        tenantId,
        agentId:      plain.agentId,
        name:         plain.name,
        description:  plain.description ?? undefined,
        inputSchema:  plain.inputSchema ?? undefined,
        outputSchema: plain.outputSchema ?? undefined,
      })
      .returning();
    if (!inserted) throw new Error('Skill insert returned no rows');
    return toDomain(inserted);
  }
}

function toDomain(row: typeof skillsTable.$inferSelect): Skill {
  return Skill.reconstitute({
    id:           asSkillId(row.id),
    agentId:      asAgentId(row.agentId),
    name:         row.name,
    description:  row.description ?? null,
    inputSchema:  row.inputSchema ?? null,
    outputSchema: row.outputSchema ?? null,
    createdAt:    row.createdAt,
  } as SkillProps);
}
