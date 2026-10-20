/**
 * THE like use case for marketplace artifacts (skills, personas, agents).
 *
 * There used to be two like stores. `POST /api/marketplace-stats/like` toggled a row
 * in `artifact_likes`, and every like button in the product reads its count back from
 * there (`GET /api/marketplace-stats/stats`). `POST /marketplace/skills/:slug/like`
 * toggled a row in `marketplace_skill_likes` and nudged `marketplace_skills.likes` by
 * ±1 — the counter the skill catalogue SORTS by. So a like from the product never
 * moved the catalogue order, a like from the old door never showed on a button, and
 * the ±1 counter drifted on every retried request.
 *
 * Now there is one store (`artifact_likes`), both doors call {@link toggleArtifactLike},
 * and for a skill the catalogue counter is RECOMPUTED from that store rather than
 * incremented, so it is self-healing instead of accumulating drift. Migration 1236
 * folded the legacy `marketplace_skill_likes` rows in and re-derived the counter.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { artifactAssignments, artifactLikes, ideAgents, marketplacePersonas, marketplaceSkills } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { NotFoundError } from '../../domain/shared/errors';
import { publicAgentScope } from './publicAgentScope';

// Mirrors the `artifact_type` enum (migration 0982: 'content' retired, 'agent'
// admitted). A marketplace agent is an artifact — the public agent listing carries a
// like count like any skill.
export const LIKEABLE_ARTIFACT_TYPES = ['skill', 'persona', 'agent'] as const;
export type LikeableArtifactType = (typeof LIKEABLE_ARTIFACT_TYPES)[number];

export function isLikeableArtifactType(value: unknown): value is LikeableArtifactType {
  return typeof value === 'string' && (LIKEABLE_ARTIFACT_TYPES as readonly string[]).includes(value);
}

export interface ArtifactStats {
  likes: number;
  installs: number;
  liked: boolean;
}

/** Most slugs one stats read answers — a listing page, not a bulk export. */
export const MAX_STATS_SLUGS = 200;

/**
 * Flip the caller's like on one artifact. Delete-first rather than read-then-write:
 * a removed row means it WAS liked; otherwise the insert (idempotent on the primary
 * key) likes it. A double-click therefore resolves to one state, not two rows.
 */
export async function toggleArtifactLike(
  db: Db,
  input: { userId: string; type: LikeableArtifactType; slug: string },
): Promise<{ liked: boolean }> {
  const { userId, type, slug } = input;
  const removed = await db
    .delete(artifactLikes)
    .where(and(
      eq(artifactLikes.userId, userId),
      eq(artifactLikes.artifactType, type),
      eq(artifactLikes.artifactSlug, slug),
    ))
    .returning({ slug: artifactLikes.artifactSlug });
  const liked = removed.length === 0;
  if (liked) {
    // A like is a row a stranger can create, so it may only name a REAL public
    // artifact — otherwise any slug mints a like row (and a count) for nothing.
    // Unliking stays unconditional: a like on a since-removed artifact can be cleared.
    if (!(await likeableArtifactExists(db, type, slug))) throw new NotFoundError('Artifact', `${type}/${slug}`);
    await db.insert(artifactLikes).values({ userId, artifactType: type, artifactSlug: slug }).onConflictDoNothing();
  }
  if (type === 'skill') await syncSkillLikeCounter(db, slug);
  return { liked };
}

/**
 * Is there a publicly listed artifact of this type under this slug? The same
 * visibility rules the purchase loaders use: a published skill, a public persona,
 * a publicly listed agent (`publicAgentScope`; an agent's artifact slug is its id).
 */
export async function likeableArtifactExists(db: Db, type: LikeableArtifactType, slug: string): Promise<boolean> {
  const rows = type === 'skill'
    ? await db.select({ slug: marketplaceSkills.slug }).from(marketplaceSkills)
      .where(and(eq(marketplaceSkills.slug, slug), eq(marketplaceSkills.published, true))).limit(1)
    : type === 'persona'
      ? await db.select({ slug: marketplacePersonas.slug }).from(marketplacePersonas)
        .where(acrossTenants(marketplacePersonas, 'public_catalogue',
          eq(marketplacePersonas.slug, slug), eq(marketplacePersonas.visibility, 'public'))).limit(1)
      : await db.select({ slug: ideAgents.id }).from(ideAgents)
        .where(publicAgentScope(eq(ideAgents.id, slug))).limit(1);
  return rows.length > 0;
}

/**
 * Re-derive `marketplace_skills.likes` from the like store. A COUNT, not a ±1, so a
 * retried or concurrent toggle cannot push the catalogue's sort key away from the
 * number the like button shows.
 */
async function syncSkillLikeCounter(db: Db, slug: string): Promise<void> {
  await db
    .update(marketplaceSkills)
    .set({
      likes: sql`(SELECT count(*)::int FROM ${artifactLikes}
                  WHERE ${artifactLikes.artifactType} = 'skill' AND ${artifactLikes.artifactSlug} = ${slug})`,
    })
    .where(eq(marketplaceSkills.slug, slug));
}

/**
 * Likes, installs (distinct tenants with a tenant-scope assignment) and the caller's
 * own like flag for a page of artifacts. `userId` null ⇒ every `liked` is false.
 */
export async function readArtifactStats(
  db: Db,
  input: { type: LikeableArtifactType; slugs: string[]; userId: string | null },
): Promise<Record<string, ArtifactStats>> {
  const { type, userId } = input;
  const slugs = input.slugs.filter(Boolean).slice(0, MAX_STATS_SLUGS);
  if (slugs.length === 0) return {};

  const [likeCounts, userLikes, installCounts] = await Promise.all([
    db
      .select({ slug: artifactLikes.artifactSlug, count: sql<number>`count(*)`.as('count') })
      .from(artifactLikes)
      .where(and(eq(artifactLikes.artifactType, type), inArray(artifactLikes.artifactSlug, slugs)))
      .groupBy(artifactLikes.artifactSlug),
    userId
      ? db
          .select({ slug: artifactLikes.artifactSlug })
          .from(artifactLikes)
          .where(and(
            eq(artifactLikes.userId, userId),
            eq(artifactLikes.artifactType, type),
            inArray(artifactLikes.artifactSlug, slugs),
          ))
      : Promise.resolve([] as { slug: string }[]),
    // Platform-wide install count by design: it is a public popularity figure, the
    // number of workspaces that installed the artifact, not any one tenant's data.
    db
      .select({
        slug: artifactAssignments.artifactSlug,
        count: sql<number>`count(DISTINCT ${artifactAssignments.tenantId})`.as('count'),
      })
      .from(artifactAssignments)
      .where(acrossTenants(
        artifactAssignments,
        'platform_aggregate',
        eq(artifactAssignments.artifactType, type),
        eq(artifactAssignments.scope, 'tenant'),
        inArray(artifactAssignments.artifactSlug, slugs),
      ))
      .groupBy(artifactAssignments.artifactSlug),
  ]);

  const likeMap = new Map(likeCounts.map((r) => [r.slug, Number(r.count)]));
  const installMap = new Map(installCounts.map((r) => [r.slug, Number(r.count)]));
  const likedSet = new Set(userLikes.map((r) => r.slug));
  const stats: Record<string, ArtifactStats> = {};
  for (const slug of slugs) {
    stats[slug] = { likes: likeMap.get(slug) ?? 0, installs: installMap.get(slug) ?? 0, liked: likedSet.has(slug) };
  }
  return stats;
}
