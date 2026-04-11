/**
 * Marketplace stats routes — unified like/unlike + batch stats for any artifact type.
 *
 * Routes:
 *   POST   /api/marketplace-stats/like          — toggle like (requires auth)
 *   GET    /api/marketplace-stats/stats          — batch stats (public; user-liked flag only if authed)
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { verifyJwt, verifyWebJwt } from '../../infrastructure/auth/JwtService';
import { artifactLikes, artifactAssignments } from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const VALID_ARTIFACT_TYPES = new Set(['skill', 'persona', 'content'] as const);
type ArtifactType = 'skill' | 'persona' | 'content';

/**
 * Soft-auth: extract userId from a bearer token if present and valid.
 * Accepts either tenant-scoped or web JWTs. Returns null if no token, bad
 * signature, or expired. Never throws.
 */
async function softAuthUserId(c: Context<HonoEnv>): Promise<string | null> {
  const header = c.req.header('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  try {
    const payload = await verifyJwt(token, c.env.JWT_SECRET);
    return payload.sub ?? null;
  } catch {
    try {
      const webPayload = await verifyWebJwt(token, c.env.JWT_SECRET);
      return webPayload.sub ?? null;
    } catch {
      return null;
    }
  }
}

export function createMarketplaceStatsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * POST /like — toggle like for an artifact. Requires tenant JWT.
   * Body: { artifactType, artifactSlug }
   * Returns: { liked: boolean }
   */
  router.post('/like', authMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ artifactType: string; artifactSlug: string }>();
    const { artifactType, artifactSlug } = body;
    if (!artifactType || !artifactSlug) {
      return c.json({ error: 'artifactType and artifactSlug are required' }, 400);
    }
    if (!VALID_ARTIFACT_TYPES.has(artifactType as ArtifactType)) {
      return c.json({ error: 'Invalid artifactType' }, 400);
    }
    const type = artifactType as ArtifactType;

    // Check if already liked
    const [existing] = await db
      .select()
      .from(artifactLikes)
      .where(
        and(
          eq(artifactLikes.userId, userId),
          eq(artifactLikes.artifactType, type),
          eq(artifactLikes.artifactSlug, artifactSlug),
        ),
      )
      .limit(1);

    if (existing) {
      // Unlike
      await db.delete(artifactLikes).where(
        and(
          eq(artifactLikes.userId, userId),
          eq(artifactLikes.artifactType, type),
          eq(artifactLikes.artifactSlug, artifactSlug),
        ),
      );
      return c.json({ liked: false });
    }

    // Like
    await db.insert(artifactLikes).values({
      userId,
      artifactType: type,
      artifactSlug,
    });
    return c.json({ liked: true });
  });

  /**
   * GET /stats — batch stats for multiple artifacts. Public.
   * If the caller is authenticated, the `liked` flag reflects their likes;
   * otherwise it is always false.
   * Query: ?type=skill&slugs=a,b,c
   * Returns: { stats: { [slug]: { likes, installs, liked } } }
   */
  router.get('/stats', async (c) => {
    const userId = await softAuthUserId(c);
    const type = c.req.query('type');
    const slugsRaw = c.req.query('slugs') ?? '';
    if (!type || !slugsRaw) {
      return c.json({ stats: {} });
    }
    if (!VALID_ARTIFACT_TYPES.has(type as ArtifactType)) {
      return c.json({ error: 'Invalid type' }, 400);
    }
    const artifactType = type as ArtifactType;
    const slugs = slugsRaw.split(',').filter(Boolean).slice(0, 200);
    if (slugs.length === 0) return c.json({ stats: {} });

    // Get like counts per slug
    const likeCounts = await db
      .select({
        slug: artifactLikes.artifactSlug,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(artifactLikes)
      .where(
        and(
          eq(artifactLikes.artifactType, artifactType),
          inArray(artifactLikes.artifactSlug, slugs),
        ),
      )
      .groupBy(artifactLikes.artifactSlug);

    // Get user's likes for these artifacts (only if authed)
    const userLikes = userId
      ? await db
          .select({ slug: artifactLikes.artifactSlug })
          .from(artifactLikes)
          .where(
            and(
              eq(artifactLikes.userId, userId),
              eq(artifactLikes.artifactType, artifactType),
              inArray(artifactLikes.artifactSlug, slugs),
            ),
          )
      : [];

    // Get install counts (distinct tenants with scope='tenant')
    const installCounts = await db
      .select({
        slug: artifactAssignments.artifactSlug,
        count: sql<number>`count(DISTINCT ${artifactAssignments.tenantId})`.as('count'),
      })
      .from(artifactAssignments)
      .where(
        and(
          eq(artifactAssignments.artifactType, artifactType),
          eq(artifactAssignments.scope, 'tenant'),
          inArray(artifactAssignments.artifactSlug, slugs),
        ),
      )
      .groupBy(artifactAssignments.artifactSlug);

    // Build result map
    const likeMap = new Map(likeCounts.map(r => [r.slug, Number(r.count)]));
    const installMap = new Map(installCounts.map(r => [r.slug, Number(r.count)]));
    const userLikedSet = new Set(userLikes.map(r => r.slug));

    const stats: Record<string, { likes: number; installs: number; liked: boolean }> = {};
    for (const slug of slugs) {
      stats[slug] = {
        likes: likeMap.get(slug) ?? 0,
        installs: installMap.get(slug) ?? 0,
        liked: userLikedSet.has(slug),
      };
    }

    return c.json({ stats });
  });

  return router;
}
