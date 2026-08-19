/**
 * The PUBLIC integration catalog — `GET /api/integrations/catalog`.
 *
 * Unauthenticated by design: this is what the marketing page at
 * `builderforce.ai/integrations` renders, and that page must answer "do you
 * support X?" to somebody who has not signed up yet. Nothing tenant-scoped is
 * exposed — the response is a projection of code-owned port registries, identical
 * for every caller (see `application/integrations/integrationCatalog`).
 *
 * Mounted BEFORE the authenticated `/api/integrations` router so the literal
 * `catalog` segment answers before `/:id` can claim it.
 *
 * No cache of its own. The first-party core is a module constant built at load
 * time, and the published-package half is served through `listPublicCatalog`'s
 * existing read-through cache — which a publish, delist or suspension already
 * invalidates. A second cache here would be a second thing to invalidate, and the
 * one most likely to be forgotten.
 */

import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  INTEGRATION_CATEGORIES,
  buildIntegrationCatalog,
  integrationCatalogByCategory,
} from '../../application/integrations/integrationCatalog';

export function createIntegrationCatalogRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/', async (c) =>
    c.json({
      // Grouped rather than flat: the category order IS the page's section order,
      // and a page that re-derived it would be free to disagree with the product.
      // Entries now include every LISTED published connector / MCP server, so the
      // page shows the ecosystem rather than only the ports we wrote ourselves.
      groups: integrationCatalogByCategory(await buildIntegrationCatalog(db, c.env as Env)),
      categories: INTEGRATION_CATEGORIES,
    }));

  return router;
}
