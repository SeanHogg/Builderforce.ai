/**
 * The skills ONE agent host must hold on disk — what the on-prem runtime syncs its
 * assigned-skills directory against, with an exact prune: a folder whose name is not
 * listed here is no longer resolvable for any run the host can serve, so it is removed.
 *
 * Wire contract: `{ skills: [{ name, updatedAt }] }` — `name` the spec name (= folder
 * name), `updatedAt` ISO-8601 of the version that would be served, or null for builtin.
 *
 * The set is {@link resolveArtifactsForHost} (tenant-wide + host grants, plus the grants
 * of every project bound to the host and every agent registered on it), restricted to
 * names the skill library can actually serve (`exportLibrarySkill` resolves the same
 * precedence: workspace, then marketplace, then builtin). `updatedAt` is the version
 * the runtime compares against what it last wrote, so an edited skill is re-fetched.
 *
 * The assignment resolution is cached under the tenant's assignment version (bumped by
 * every assignment writer). The timestamps are read live, in two batched queries,
 * because a skill edit — workspace or marketplace — must reach the host on its next
 * sync without every editor knowing which hosts hold it.
 */

import { eq, inArray } from 'drizzle-orm';
import { isValidSkillName } from '@builderforce/agent-skills';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { marketplaceSkills, tenantSkills } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { resolveArtifactsForHost } from '../artifact/resolveArtifacts';
import { getBuiltinSkillBody } from '../artifact/builtinSkills';
import { skillAssignmentCacheKey } from './skillAssignmentCache';
import { withholdUnpaidSkills } from '../marketplace/skillEntitlement';

export interface HostSkillEntry {
  name: string;
  /** ISO-8601; null for a builtin skill, which changes only with a platform release. */
  updatedAt: string | null;
}

export async function listHostSkills(env: Env | undefined, db: Db, tenantId: number, agentHostId: number): Promise<HostSkillEntry[]> {
  const assigned = await getOrSetCached(
    env,
    await skillAssignmentCacheKey(env, tenantId, `host:${agentHostId}`),
    async () => (await resolveArtifactsForHost(db, tenantId, agentHostId)).skills,
    // Assignment writes bump the version at once. Binding a project to the host or
    // registering an agent on it also widens the set, and those writers do not know
    // about skills — the short TTL is what bounds that staleness to minutes.
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
  // `name` is also the folder name the runtime writes and checks the package against, so
  // only a valid spec name is listed — a legacy slug the spec forbids could never land
  // as a folder that matches it.
  // …and a paid skill only with its entitlement, so the host never syncs a folder the
  // package route would refuse.
  const slugs = await withholdUnpaidSkills(db, tenantId, assigned.filter(isValidSkillName), 'hostSkillListing');
  if (slugs.length === 0) return [];

  const [own, listed] = await Promise.all([
    db
      .select({ slug: tenantSkills.slug, updatedAt: tenantSkills.updatedAt })
      .from(tenantSkills)
      .where(scopedToTenant(tenantSkills, tenantId, eq(tenantSkills.status, 'approved'), inArray(tenantSkills.slug, slugs))),
    db
      .select({ slug: marketplaceSkills.slug, updatedAt: marketplaceSkills.updatedAt })
      .from(marketplaceSkills)
      .where(inArray(marketplaceSkills.slug, slugs)),
  ]);
  const ownAt = new Map(own.map((r) => [r.slug, r.updatedAt]));
  const listedAt = new Map(listed.map((r) => [r.slug, r.updatedAt]));

  const out: HostSkillEntry[] = [];
  for (const name of slugs) {
    const at = ownAt.get(name) ?? listedAt.get(name);
    if (at) out.push({ name, updatedAt: new Date(at).toISOString() });
    else if (getBuiltinSkillBody(name)) out.push({ name, updatedAt: null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
