import { eq } from 'drizzle-orm';
import { ISkillRepository } from '../../domain/skill/ISkillRepository';
import { Skill, SkillProps } from '../../domain/skill/Skill';
import { SkillId, AgentId, TenantId, asSkillId, asAgentId } from '../../domain/shared/types';
import { agentRegistrations, skills as skillsTable } from '../database/schema';
import type { Db } from '../database/connection';

/**
 * Legacy `skills` rows, now owned through `agent_registration_id` (backfilled in
 * migration 1347). `agent_id` remains a plain integer compatibility reference — its
 * FK was dropped in 1347 — and is what the legacy `/api/skills` projection exposes.
 */
export class SkillRepository implements ISkillRepository {
  constructor(private readonly db: Db) {}

  async findById(id: SkillId): Promise<Skill | null> {
    const [row] = await this.db
      .select().from(skillsTable)
      .where(eq(skillsTable.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  /** Every skill on the tenant, resolved through the registration owner link. */
  async findAllByTenant(tenantId: TenantId): Promise<Skill[]> {
    const rows = await this.db
      .select({ skill: skillsTable })
      .from(skillsTable)
      .innerJoin(agentRegistrations, eq(skillsTable.agentRegistrationId, agentRegistrations.id))
      .where(eq(agentRegistrations.tenantId, tenantId));
    return rows.map((r) => toDomain(r.skill));
  }

  /** Every skill owned by one agent (its legacy `agent_id` compatibility reference). */
  async findAllByAgent(agentId: AgentId): Promise<Skill[]> {
    const rows = await this.db
      .select({ skill: skillsTable })
      .from(skillsTable)
      .where(eq(skillsTable.agentId, agentId));
    return rows.map((r) => toDomain(r.skill));
  }

  async save(skill: Skill): Promise<Skill> {
    const plain = skill.toPlain();
    const [inserted] = await this.db
      .insert(skillsTable)
      .values({
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
