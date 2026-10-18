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
import { Hono, type Context } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { browsePublicListings } from '../../application/knowledge/knowledgeMarket';

/** The canonical public browse path; `/api/knowledge/listings` is its deprecated alias. */
export const KNOWLEDGE_LISTINGS_PATH = '/api/knowledge-market/listings';

/**
 * The ONE public-listings handler (cross-tenant, cached). The authed knowledge router
 * serves it too, at its legacy path, so the two can never answer differently.
 */
export function browseListingsHandler(db: Db) {
  return async (c: Context<HonoEnv>) => c.json({ listings: await browsePublicListings(c.env as Env, db) });
}

export function createKnowledgeMarketRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.get('/listings', browseListingsHandler(db));
  return router;
}
