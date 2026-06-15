/**
 * Agent capability manifests — the per-agent set of ASSIGNED artifacts (skills,
 * personas, content) with display names, for every workforce agent of a tenant.
 *
 * This is what the /workforce cards render ("Assigned configuration") and what the
 * "Copy manifest" button shares. It is deliberately the AGENT-SCOPED assignment set
 * only (`artifact_assignments.scope = 'agent'`) — the config that travels WITH the
 * agent — NOT the full resolved hierarchy (tenant/project/task) a run also inherits.
 * Surfacing exactly what is pinned to the agent is the point: a card that shows "No
 * skills or personas assigned" is the honest signal that an agent was auto-staffed a
 * task it has no configured capability for (the exec #61 confusion).
 *
 * Served through the canonical read-through cache, keyed per tenant (a bounded
 * keyspace — one entry per tenant), and invalidated by every agent-scoped artifact
 * assignment write via {@link invalidateAgentManifests}. Composed in ONE pass (no
 * per-agent N+1): one identities query, one assignments query, two batched name
 * lookups.
 */
import { eq, and, inArray, isNull } from 'drizzle-orm';
import {
  artifactAssignments,
  projectAgents,
  marketplaceSkills,
  platformPersonas,
} from '../../infrastructure/database/schema';
import { AssignmentScope, ArtifactType } from '../../domain/shared/types';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** An assigned artifact with its marketplace display name (null when unpublished /
 *  bodyless — e.g. content artifacts have no name store yet, shown by slug). */
export interface NamedArtifact {
  slug: string;
  name: string | null;
}

/** The capabilities pinned directly to one agent (agent-scoped assignments). */
export interface AgentManifest {
  skills: NamedArtifact[];
  personas: NamedArtifact[];
  content: NamedArtifact[];
}

const cacheKey = (tenantId: number) => `agent-manifests:tenant:${tenantId}`;

const byDisplay = (a: NamedArtifact, b: NamedArtifact) =>
  (a.name ?? a.slug).localeCompare(b.name ?? b.slug);

/**
 * Load every workforce agent's assigned-capability manifest for a tenant, keyed by
 * the agent's `agentRef` (= its `ide_agents.id` / `PublishedAgent.id`). Agents with
 * no agent-scoped assignments are simply absent from the map.
 */
export async function loadAgentManifests(
  env: Env,
  db: Db,
  tenantId: number,
): Promise<Record<string, AgentManifest>> {
  return getOrSetCached<Record<string, AgentManifest>>(env, cacheKey(tenantId), async () => {
    // Canonical (project-less) workforce identities — the rows whose `id` is the
    // `scope_id` for this agent's `scope='agent'` assignments.
    const identities = await db
      .select({ id: projectAgents.id, agentRef: projectAgents.agentRef })
      .from(projectAgents)
      .where(and(
        eq(projectAgents.tenantId, tenantId),
        eq(projectAgents.agentKind, 'workforce'),
        isNull(projectAgents.projectId),
      ));
    if (identities.length === 0) return {};

    const refByScopeId = new Map<number, string>(identities.map((i) => [i.id, i.agentRef]));
    const rows = await db
      .select({
        scopeId: artifactAssignments.scopeId,
        artifactType: artifactAssignments.artifactType,
        artifactSlug: artifactAssignments.artifactSlug,
      })
      .from(artifactAssignments)
      .where(and(
        eq(artifactAssignments.tenantId, tenantId),
        eq(artifactAssignments.scope, AssignmentScope.AGENT),
        inArray(artifactAssignments.scopeId, identities.map((i) => i.id)),
      ));
    if (rows.length === 0) return {};

    // Batch the display-name lookups: one query per artifact table over the distinct
    // slugs, not one per assignment.
    const skillSlugs = new Set<string>();
    const personaSlugs = new Set<string>();
    for (const r of rows) {
      if (r.artifactType === ArtifactType.SKILL) skillSlugs.add(r.artifactSlug);
      else if (r.artifactType === ArtifactType.PERSONA) personaSlugs.add(r.artifactSlug);
    }
    const [skillRows, personaRows] = await Promise.all([
      skillSlugs.size
        ? db.select({ slug: marketplaceSkills.slug, name: marketplaceSkills.name })
            .from(marketplaceSkills).where(inArray(marketplaceSkills.slug, [...skillSlugs]))
        : Promise.resolve([] as Array<{ slug: string; name: string }>),
      personaSlugs.size
        ? db.select({ slug: platformPersonas.slug, name: platformPersonas.name })
            .from(platformPersonas).where(inArray(platformPersonas.slug, [...personaSlugs]))
        : Promise.resolve([] as Array<{ slug: string; name: string }>),
    ]);
    const skillName = new Map(skillRows.map((s) => [s.slug, s.name]));
    const personaName = new Map(personaRows.map((p) => [p.slug, p.name]));

    const manifests: Record<string, AgentManifest> = {};
    const ensure = (ref: string): AgentManifest =>
      (manifests[ref] ??= { skills: [], personas: [], content: [] });

    for (const r of rows) {
      const ref = refByScopeId.get(r.scopeId);
      if (!ref) continue;
      const m = ensure(ref);
      if (r.artifactType === ArtifactType.SKILL) {
        m.skills.push({ slug: r.artifactSlug, name: skillName.get(r.artifactSlug) ?? null });
      } else if (r.artifactType === ArtifactType.PERSONA) {
        m.personas.push({ slug: r.artifactSlug, name: personaName.get(r.artifactSlug) ?? null });
      } else if (r.artifactType === ArtifactType.CONTENT) {
        m.content.push({ slug: r.artifactSlug, name: null });
      }
    }
    for (const m of Object.values(manifests)) {
      m.skills.sort(byDisplay);
      m.personas.sort(byDisplay);
      m.content.sort(byDisplay);
    }
    return manifests;
  });
}

/** Drop the cached manifest map for a tenant. Call from every agent-scoped artifact
 *  assignment mutation so the next /workforce read reflects the change immediately. */
export async function invalidateAgentManifests(env: Env, tenantId: number): Promise<void> {
  await invalidateCached(env, cacheKey(tenantId));
}
