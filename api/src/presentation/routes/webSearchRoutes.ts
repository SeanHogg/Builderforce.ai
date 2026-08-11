import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { buildInternetSearch } from '../../application/webSearch/factory';

export function createWebSearchRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>(); router.use('*', authMiddleware);
  router.post('/', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { query?: string; limit?: number; offset?: number; page?: number; domains?: string[]; language?: string; freshness?: string; since?: string };
    const limit = body.limit ?? 10; const offset = body.offset ?? (body.page && body.page > 1 ? (body.page - 1) * limit : 0);
    try { return c.json(await buildInternetSearch(db).search.search(c.get('tenantId'), { ...body, query: body.query ?? '', limit, offset })); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid search request' }, 400); }
  });
  router.post('/open', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { url?: string };
    if (!body.url) return c.json({ error: 'url is required' }, 400);
    try { const result = await buildInternetSearch(db).search.open(c.get('tenantId'), body.url); return result ? c.json(result) : c.json({ error: 'Page is not present in the crawled corpus' }, 404); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid URL' }, 400); }
  });
  router.post('/sources', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await c.req.json().catch(() => ({})) as { seedUrl?: string; allowedDomains?: string[]; blockedDomains?: string[]; maxDepth?: number; crawlDelayMs?: number };
    if (!body.seedUrl) return c.json({ error: 'seedUrl is required' }, 400);
    try { return c.json({ source: await buildInternetSearch(db).crawler.addSource(c.get('tenantId'), { ...body, seedUrl: body.seedUrl }) }, 201); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid crawl source' }, 400); }
  });
  router.post('/crawl', requireRole(TenantRole.MANAGER), async (c) => {
    const body = await c.req.json().catch(() => ({})) as { limit?: number };
    return c.json(await buildInternetSearch(db).crawler.runBatch(c.get('tenantId'), body.limit), 202);
  });
  return router;
}

