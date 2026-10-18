/**
 * Marketplace stats routes — unified like/unlike + batch stats for any artifact type.
 *
 * Routes:
 *   POST   /api/marketplace-stats/like          — toggle like (requires auth)
 *   GET    /api/marketplace-stats/stats          — batch stats (public; user-liked flag only if authed)
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware';
import { optionalWebUserId } from '../middleware/webAuthMiddleware';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  isLikeableArtifactType,
  readArtifactStats,
  toggleArtifactLike,
} from '../../application/marketplace/artifactLikes';
import { parseBody, z } from './requestBody';

/** `POST /like` — the handler answers its own required / invalid-type messages. */
const LikeBody = z.object({ artifactType: z.string().nullish(), artifactSlug: z.string().nullish() });

/**
 * Soft-auth: the caller's user id when a valid, unrevoked tenant OR web token is
 * present; `null` otherwise. Both halves come from the shared middleware so
 * revocation applies here exactly as it does on every other route — this used to
 * re-verify signatures by hand and accepted signed-out tokens.
 */
async function softAuthUserId(c: Context<HonoEnv>): Promise<string | null> {
  await optionalAuthMiddleware(c, async () => {});
  const tenantUser = c.get('userId');
  if (tenantUser) return tenantUser;
  return optionalWebUserId(c);
}

export function createMarketplaceStatsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * POST /like — toggle like for an artifact. Requires tenant JWT. THE like door:
   * `/marketplace/skills/:slug/like` is a deprecated adapter onto the same use case.
   * Body: { artifactType, artifactSlug }
   * Returns: { liked: boolean }
   */
  router.post('/like', authMiddleware, async (c) => {
    const { artifactType, artifactSlug } = await parseBody(c, LikeBody);
    if (!artifactType || !artifactSlug) {
      return c.json({ error: 'artifactType and artifactSlug are required' }, 400);
    }
    if (!isLikeableArtifactType(artifactType)) {
      return c.json({ error: 'Invalid artifactType' }, 400);
    }
    const { liked } = await toggleArtifactLike(db, { userId: c.get('userId') as string, type: artifactType, slug: artifactSlug });
    return c.json({ liked });
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
    if (!isLikeableArtifactType(type)) {
      return c.json({ error: 'Invalid type' }, 400);
    }
    return c.json({ stats: await readArtifactStats(db, { type, slugs: slugsRaw.split(','), userId }) });
  });

  return router;
}
