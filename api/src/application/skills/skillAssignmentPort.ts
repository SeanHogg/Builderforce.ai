/**
 * Skill assignments — the ONE place that reads and writes them, at either scope.
 *
 * Before migration 1108 this was two tables, and the consequence was not the
 * storage but the duplication above it: `skillAssignmentRoutes` and
 * `agentHostRoutes` each carried the same select-with-join twice, once per scope,
 * and each write path re-typed its own conflict target. Six copies of one query,
 * any of which could drift from the others.
 *
 * The scope is now a column, so it is also a PARAMETER here rather than a second
 * function: `scope: 'tenant'` and `scope: 'host'` walk the same code, which is what
 * makes them impossible to drift apart. Callers never name the table.
 */

import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { marketplaceSkills, skillAssignments } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

/** Which level an assignment applies at. A host-scoped target names its host. */
export type SkillAssignmentTarget =
  | { scope: 'tenant' }
  | { scope: 'host'; agentHostId: number };

/** One assigned skill, with the marketplace metadata the UI renders beside it. */
export interface AssignedSkill {
  skillSlug: string;
  assignedBy: string | null;
  assignedAt: Date;
  skillName: string | null;
  skillDesc: string | null;
  skillIcon: string | null;
  skillVer: string | null;
}

/**
 * The predicate for one target, always tenant-scoped.
 *
 * `isNull(agentHostId)` is load-bearing on the tenant branch: without it a tenant
 * listing would also return every host-scoped row in the workspace, which is the
 * bug the two-table split made structurally impossible and a single table makes
 * available to anybody who forgets.
 */
function targetWhere(tenantId: number, target: SkillAssignmentTarget) {
  return target.scope === 'host'
    ? scopedToTenant(skillAssignments, tenantId, eq(skillAssignments.agentHostId, target.agentHostId))
    : scopedToTenant(skillAssignments, tenantId, isNull(skillAssignments.agentHostId));
}

/** Skills assigned at this target, with their marketplace metadata. */
export async function listAssignedSkills(
  db: Db,
  tenantId: number,
  target: SkillAssignmentTarget,
): Promise<AssignedSkill[]> {
  return db
    .select({
      skillSlug: skillAssignments.skillSlug,
      assignedBy: skillAssignments.assignedBy,
      assignedAt: skillAssignments.assignedAt,
      skillName: marketplaceSkills.name,
      skillDesc: marketplaceSkills.description,
      skillIcon: marketplaceSkills.iconUrl,
      skillVer: marketplaceSkills.version,
    })
    .from(skillAssignments)
    .leftJoin(marketplaceSkills, eq(skillAssignments.skillSlug, marketplaceSkills.slug))
    .where(targetWhere(tenantId, target));
}

/** Does this slug name a real marketplace skill? Both write paths ask first. */
export async function marketplaceSkillExists(db: Db, skillSlug: string): Promise<boolean> {
  const [row] = await db
    .select({ slug: marketplaceSkills.slug })
    .from(marketplaceSkills)
    .where(eq(marketplaceSkills.slug, skillSlug))
    .limit(1);
  return Boolean(row);
}

/**
 * Assign a skill. Idempotent: re-assigning an already-assigned skill is a no-op
 * rather than an error, which is what both callers relied on the old per-table
 * `onConflictDoNothing` for.
 *
 * The conflict target is left to the two partial unique indexes (migration 1108)
 * rather than named here — naming one would be naming the wrong one for the other
 * scope.
 */
export async function assignSkill(
  db: Db,
  tenantId: number,
  target: SkillAssignmentTarget,
  input: { skillSlug: string; assignedBy: string },
): Promise<void> {
  await db
    .insert(skillAssignments)
    .values({
      tenantId,
      scope: target.scope,
      agentHostId: target.scope === 'host' ? target.agentHostId : null,
      skillSlug: input.skillSlug,
      assignedBy: input.assignedBy,
    })
    .onConflictDoNothing();
}

/** Remove an assignment at this target. Absent is success — the caller asked for
 *  it to be gone, and it is. */
export async function unassignSkill(
  db: Db,
  tenantId: number,
  target: SkillAssignmentTarget,
  skillSlug: string,
): Promise<void> {
  await db
    .delete(skillAssignments)
    .where(and(targetWhere(tenantId, target), eq(skillAssignments.skillSlug, skillSlug)));
}

/** An effective skill, with the scope it was granted at. */
export interface EffectiveSkill extends AssignedSkill {
  /** 'host' wins over 'tenant' for the same slug. */
  source: 'tenant' | 'host';
}

/**
 * Every skill an agent host may actually use: the tenant-wide grants plus the
 * host's own, with the host's winning on a shared slug.
 *
 * ONE query. It was two — a tenant listing and a host listing, merged in a Map by
 * the caller — because the grants lived in two tables. That shape also lost the
 * tenant predicate on the host half, which was safe only because the route had
 * already checked the host belonged to the caller; here the predicate is
 * unconditional, so the safety does not depend on the order of the checks above it.
 *
 * The override is resolved here rather than by the caller because "host beats
 * tenant" is the rule, and a rule that lives in a route lives in exactly one route.
 */
export async function effectiveSkillsForHost(
  db: Db,
  tenantId: number,
  agentHostId: number,
): Promise<EffectiveSkill[]> {
  const rows = await db
    .select({
      skillSlug: skillAssignments.skillSlug,
      assignedBy: skillAssignments.assignedBy,
      assignedAt: skillAssignments.assignedAt,
      agentHostId: skillAssignments.agentHostId,
      skillName: marketplaceSkills.name,
      skillDesc: marketplaceSkills.description,
      skillIcon: marketplaceSkills.iconUrl,
      skillVer: marketplaceSkills.version,
    })
    .from(skillAssignments)
    .leftJoin(marketplaceSkills, eq(skillAssignments.skillSlug, marketplaceSkills.slug))
    .where(scopedToTenant(
      skillAssignments,
      tenantId,
      or(isNull(skillAssignments.agentHostId), eq(skillAssignments.agentHostId, agentHostId)),
    ));

  // Host grants are applied second so they overwrite the tenant grant for a slug
  // held at both levels — the same precedence the two-query version encoded by the
  // order it filled its Map, now stated rather than implied by statement order.
  const effective = new Map<string, EffectiveSkill>();
  for (const row of rows) {
    const { agentHostId: host, ...rest } = row;
    const source = host === null ? 'tenant' : 'host';
    if (source === 'tenant' && effective.has(row.skillSlug)) continue;
    effective.set(row.skillSlug, { ...rest, source });
  }
  return [...effective.values()];
}
