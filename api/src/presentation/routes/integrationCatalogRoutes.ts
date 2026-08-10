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
 * Uncached on purpose: the handler serialises a module constant built at load
 * time. There is no DB round-trip and no external call to amortise, so a cache
 * would add a KV round-trip to a synchronous read — the same reason
 * `GET /api/tools` is uncached.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import {
  INTEGRATION_CATEGORIES,
  integrationCatalogByCategory,
} from '../../application/integrations/integrationCatalog';

export function createIntegrationCatalogRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.get('/', (c) =>
    c.json({
      // Grouped rather than flat: the category order IS the page's section order,
      // and a page that re-derived it would be free to disagree with the product.
      groups: integrationCatalogByCategory(),
      categories: INTEGRATION_CATEGORIES,
    }));

  return router;
}
