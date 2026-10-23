/**
 * Skill assignments — the ONE place that reads and writes them, at either scope.
 *
 * They live in `artifact_assignments`, the store `resolveArtifacts` reads for run
 * prompts, the skill library catalog and the on-prem sync. Until migration 1261 they
 * had a second home, `skill_assignments` (1108), which fed only the host panel — so a
 * grant made there never reached a run. 1261 folded its rows in; nothing reads or
 * writes `skill_assignments` any more, and the held contract migration drops it.
 *
 * The scope is a PARAMETER here rather than a second function: `scope: 'tenant'`
 * (scope_id = the tenant) and `scope: 'host'` (scope_id = the agent host) walk the
 * same code. Callers never name the table. Every write drops the cached assignment
 * reads through {@link invalidateSkillAssignmentCaches}.
 */

import { and, eq, or } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { artifactAssignments, marketplaceSkills } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { invalidateSkillAssignmentCaches } from './skillAssignmentCache';
import { assertSkillAssignable } from '../marketplace/skillEntitlement';

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

/** The (scope, scope_id) one target names. */
function scopeOf(tenantId: number, target: SkillAssignmentTarget): { scope: 'tenant' | 'host'; scopeId: number } {
  return target.scope === 'host'
    ? { scope: 'host', scopeId: target.agentHostId }
    : { scope: 'tenant', scopeId: tenantId };
}

/** The predicate for one target: always tenant-scoped, always skills only. */
function targetWhere(tenantId: number, target: SkillAssignmentTarget) {
  const { scope, scopeId } = scopeOf(tenantId, target);
  return scopedToTenant(
    artifactAssignments,
    tenantId,
    eq(artifactAssignments.artifactType, 'skill'),
    eq(artifactAssignments.scope, scope),
    eq(artifactAssignments.scopeId, scopeId),
  );
}

/** Skills assigned at this target, with their marketplace metadata. */
export async function listAssignedSkills(
  db: Db,
  tenantId: number,
  target: SkillAssignmentTarget,
): Promise<AssignedSkill[]> {
  return db
    .select({
      skillSlug: artifactAssignments.artifactSlug,
      assignedBy: artifactAssignments.assignedBy,
      assignedAt: artifactAssignments.assignedAt,
      skillName: marketplaceSkills.name,
      skillDesc: marketplaceSkills.description,
      skillIcon: marketplaceSkills.iconUrl,
      skillVer: marketplaceSkills.version,
    })
    .from(artifactAssignments)
    .leftJoin(marketplaceSkills, eq(artifactAssignments.artifactSlug, marketplaceSkills.slug))
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
 * rather than an error (the composite primary key is the conflict target). A paid skill
 * the workspace has not bought throws `SkillPaymentRequired` (402).
 */
export async function assignSkill(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  target: SkillAssignmentTarget,
  input: { skillSlug: string; assignedBy: string },
): Promise<void> {
  await assertSkillAssignable(db, tenantId, 'skill', input.skillSlug);
  await db
    .insert(artifactAssignments)
    .values({
      tenantId,
      artifactType: 'skill',
      artifactSlug: input.skillSlug,
      ...scopeOf(tenantId, target),
      assignedBy: input.assignedBy,
    })
    .onConflictDoNothing();
  await invalidateSkillAssignmentCaches(env, tenantId);
}

/** Remove an assignment at this target. Absent is success — the caller asked for
 *  it to be gone, and it is. */
export async function unassignSkill(
  env: Env | undefined,
  db: Db,
  tenantId: number,
  target: SkillAssignmentTarget,
  skillSlug: string,
): Promise<void> {
  await db
    .delete(artifactAssignments)
    .where(and(targetWhere(tenantId, target), eq(artifactAssignments.artifactSlug, skillSlug)));
  await invalidateSkillAssignmentCaches(env, tenantId);
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
      skillSlug: artifactAssignments.artifactSlug,
      assignedBy: artifactAssignments.assignedBy,
      assignedAt: artifactAssignments.assignedAt,
      scope: artifactAssignments.scope,
      skillName: marketplaceSkills.name,
      skillDesc: marketplaceSkills.description,
      skillIcon: marketplaceSkills.iconUrl,
      skillVer: marketplaceSkills.version,
    })
    .from(artifactAssignments)
    .leftJoin(marketplaceSkills, eq(artifactAssignments.artifactSlug, marketplaceSkills.slug))
    .where(scopedToTenant(
      artifactAssignments,
      tenantId,
      eq(artifactAssignments.artifactType, 'skill'),
      or(
        and(eq(artifactAssignments.scope, 'tenant'), eq(artifactAssignments.scopeId, tenantId)),
        and(eq(artifactAssignments.scope, 'host'), eq(artifactAssignments.scopeId, agentHostId)),
      ),
    ));

  // Host grants are applied second so they overwrite the tenant grant for a slug
  // held at both levels — the same precedence the two-query version encoded by the
  // order it filled its Map, now stated rather than implied by statement order.
  const effective = new Map<string, EffectiveSkill>();
  for (const row of rows) {
    const { scope, ...rest } = row;
    const source = scope === 'host' ? 'host' : 'tenant';
    if (source === 'tenant' && effective.has(row.skillSlug)) continue;
    effective.set(row.skillSlug, { ...rest, source });
  }
  return [...effective.values()];
}
