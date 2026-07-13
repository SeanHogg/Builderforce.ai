/**
 * PUBLIC knowledge marketplace routes — mounted at `/api/knowledge-market`.
 *
 * Unlike `/api/knowledge/*` (globally tenant-authed), these routes are PUBLIC so
 * logged-out visitors can browse what knowledge is for sale, exactly like the
 * public skills feed. They read only `visibility = 'public'` listings and expose
 * no tenant-private data. Installing/purchasing still lives under the authed
 * knowledge router (it copies a doc into a tenant), so there is nothing to gate
 * here — this is browse-only.
 */
import { Hono } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { browsePublicListings } from '../../application/knowledge/knowledgeMarket';

export function createKnowledgeMarketRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Browse all public listings (cross-tenant, cached).
  router.get('/listings', async (c) => {
    const listings = await browsePublicListings(c.env as Env, db);
    return c.json({ listings });
  });

  return router;
}
