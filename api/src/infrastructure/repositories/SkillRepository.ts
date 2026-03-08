import { eq } from 'drizzle-orm';
import { ISkillRepository } from '../../domain/skill/ISkillRepository';
import { Skill, SkillProps } from '../../domain/skill/Skill';
import { SkillId, AgentId, asSkillId, asAgentId } from '../../domain/shared/types';
import { skills as skillsTable } from '../database/schema';
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

  async findAll(): Promise<Skill[]> {
    const rows = await this.db.select().from(skillsTable);
    return rows.map(toDomain);
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
