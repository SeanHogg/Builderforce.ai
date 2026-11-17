import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { agentRegistrations, skills } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

/**
 * Reads behind the legacy `/api/agents` + `/api/skills` surface (PRD 39 §3 push 1).
 *
 * The numeric `agents` table is read by nothing: a legacy numeric id is the folded
 * `agent_registrations.legacy_agent_id` (migration 0394), and a legacy skill row is
 * owned through `skills.agent_registration_id` (1347) and scoped by `skills.tenant_id`
 * (1351). Every query is tenant-scoped — a cross-tenant id resolves to nothing.
 */

export type LegacyAgentRow = typeof agentRegistrations.$inferSelect;
export type LegacySkillRow = typeof skills.$inferSelect;

export class LegacyAgentRegistry {
  constructor(private readonly db: Db) {}

  /** Every registration on the tenant, ordered by the numeric id legacy clients sort on. */
  async listAgents(tenantId: number): Promise<LegacyAgentRow[]> {
    return this.db
      .select().from(agentRegistrations)
      .where(scopedToTenant(agentRegistrations, tenantId))
      .orderBy(agentRegistrations.legacyAgentId);
  }

  /** The registration that carries `legacyId` on the tenant, or null. */
  async findAgent(tenantId: number, legacyId: number): Promise<LegacyAgentRow | null> {
    const [row] = await this.db
      .select().from(agentRegistrations)
      .where(scopedToTenant(agentRegistrations, tenantId, eq(agentRegistrations.legacyAgentId, legacyId)))
      .limit(1);
    return row ?? null;
  }

  /** Marks the tenant's registration for `legacyId` inactive; null when it is not the tenant's. */
  async deactivateAgent(tenantId: number, legacyId: number): Promise<LegacyAgentRow | null> {
    const row = await this.findAgent(tenantId, legacyId);
    if (!row) return null;
    const [updated] = await this.db
      .update(agentRegistrations)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(scopedToTenant(agentRegistrations, tenantId, eq(agentRegistrations.id, row.id)))
      .returning();
    return updated ?? null;
  }

  /** Skills on one of the tenant's registrations, by skill id. */
  async listAgentSkills(tenantId: number, registrationId: string): Promise<LegacySkillRow[]> {
    return this.db
      .select().from(skills)
      .where(scopedToTenant(skills, tenantId, eq(skills.agentRegistrationId, registrationId)))
      .orderBy(skills.id);
  }

  /** Every skill on the tenant's registrations, by skill id. */
  async listTenantSkills(tenantId: number): Promise<LegacySkillRow[]> {
    const registrations = await this.db
      .select({ id: agentRegistrations.id })
      .from(agentRegistrations)
      .where(scopedToTenant(agentRegistrations, tenantId));
    const registrationIds = registrations.map((r) => r.id);
    if (registrationIds.length === 0) return [];
    return this.db
      .select().from(skills)
      .where(scopedToTenant(skills, tenantId, inArray(skills.agentRegistrationId, registrationIds)))
      .orderBy(skills.id);
  }
}
