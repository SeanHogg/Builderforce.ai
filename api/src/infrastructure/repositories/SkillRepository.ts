import { eq } from 'drizzle-orm';
import { scopedToTenant } from '../database/tenantScope';
import { ISkillRepository } from '../../domain/skill/ISkillRepository';
import { Skill, SkillProps } from '../../domain/skill/Skill';
import { SkillId, AgentId, TenantId, asSkillId, asAgentId } from '../../domain/shared/types';
import { agents as agentsTable, skills as skillsTable } from '../database/schema';
import type { Db } from '../database/connection';

export class SkillRepository implements ISkillRepository {
  constructor(private readonly db: Db) {}

  async findById(id: SkillId): Promise<Skill | null> {
    const [row] = await this.db
      .select().from(skillsTable)
      .where(eq(skillsTable.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  async findAllByAgent(agentId: AgentId): Promise<Skill[]> {
    const rows = await this.db
      .select().from(skillsTable)
      .where(eq(skillsTable.agentId, agentId));
    return rows.map(toDomain);
  }

  async findAllByTenant(tenantId: TenantId): Promise<Skill[]> {
    // `skills` has no tenant column; ownership is the agent's.
    const rows = await this.db
      .select({ skill: skillsTable })
      .from(skillsTable)
      .innerJoin(agentsTable, eq(skillsTable.agentId, agentsTable.id))
      .where(scopedToTenant(agentsTable, tenantId));
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
