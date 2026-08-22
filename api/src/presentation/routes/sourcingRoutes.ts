/**
 * Job sourcing routes — /api/sourcing
 *
 * ── WHY CONFIGURING A FEED IS MANAGER+ AND READING IT IS NOT ─────────────────
 * A feed URL is a URL this platform will fetch on a schedule, with the
 * workspace's name on the User-Agent. That is an outbound capability, so it sits
 * at the same level as provisioning a phone number. Reading the listings that
 * came back is the product working, and gating that too would make a sourcing
 * feature only managers could use.
 *
 * ── THE MANUAL SYNC IS DELIBERATELY THE SAME CODE AS THE CRON ────────────────
 * `POST /sources/:id/sync` calls `syncJobSource`, which is exactly what the sweep
 * calls per row. The source product had a manual path and a scheduled path that
 * had drifted — the manual one skipped the sync-log write — so "it works when I
 * click it" and "it fails overnight" were both true and neither was diagnosable.
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import {
  JOB_LISTING_KIND, listingsVersionKey, syncJobSource,
} from '../../application/sourcing/runSourcingSweep';
import {
  deleteSource, getSource, listSources, saveSource, type SourceConfig,
} from '../../application/sourcing/sourcingSources';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { catalogItems } from '../../infrastructure/database/schema';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';

const LISTINGS_TTL_SECONDS = 120;

/**
 * The listing cache is keyed by TENANT, QUERY and LIMIT, which makes the keyspace
 * unbounded — a member can type anything. So it carries a VERSION TOKEN rather
 * than being invalidated key by key: a write bumps the token once and every
 * cached answer under the old one is orphaned in a single write, whatever queries
 * happen to be in flight.
 *
 * `listingsVersionKey` is imported from the SWEEP, not declared here: the writer
 * owns invalidation, and a second definition beside the reader is how the cron
 * path ends up bumping a different token from the one the route reads.
 */
const listingsKey = (version: string, tenantId: number, q: string, limit: number) =>
  `sourcing:listings:v:${version}:t:${tenantId}:q:${q}:n:${limit}`;

export function createSourcingRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── Listings ────────────────────────────────────────────────────────────
  //
  // Cached: this is the read every member hits and the rows only change when a
  // sweep runs, which is hourly at most. The key carries the query because the
  // filter is part of the answer.
  router.get('/listings', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 80);
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200);

    const version = await getCacheVersion(c.env as Env, listingsVersionKey(tenantId));
    const rows = await getOrSetCached(c.env as Env, listingsKey(version, tenantId, q, limit), async () => {
      const found = await db.select({
        id: catalogItems.id,
        name: catalogItems.name,
        summary: catalogItems.summary,
        body: catalogItems.body,
        category: catalogItems.category,
        publishedAt: catalogItems.publishedAt,
        updatedAt: catalogItems.updatedAt,
      })
        .from(catalogItems)
        .where(and(
          eq(catalogItems.tenantId, tenantId),
          eq(catalogItems.kind, JOB_LISTING_KIND),
        ))
        .orderBy(desc(catalogItems.publishedAt))
        // Filtering in memory over a bounded page would silently drop matches
        // beyond it, so the cap is applied AFTER the filter — see below.
        .limit(q ? 500 : limit);

      const matched = q
        ? found.filter((row) => `${row.name} ${row.summary ?? ''}`.toLowerCase().includes(q))
        : found;

      return matched.slice(0, limit).map((row) => {
        const body = (row.body ?? {}) as Record<string, unknown>;
        return {
          id: row.id,
          title: row.name,
          summary: row.summary ?? '',
          company: String(body.company ?? ''),
          location: String(body.location ?? ''),
          url: String(body.url ?? ''),
          jobType: row.category ?? '',
          seenAt: (row.publishedAt ?? row.updatedAt).toISOString(),
        };
      });
    }, { kvTtlSeconds: LISTINGS_TTL_SECONDS });

    return c.json({ rows });
  });

  // ── Sources ─────────────────────────────────────────────────────────────
  router.get('/sources', requireRole(TenantRole.MANAGER), async (c) => {
    return c.json({ rows: await listSources(db, c.get('tenantId') as number) });
  });

  router.post('/sources', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      name?: string; vendor?: string; url?: string; format?: string;
      itemsPath?: string; mapping?: Record<string, string>; apiKey?: string;
    }>().catch(() => ({}));

    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);
    if (!body.url?.trim()) return c.json({ error: 'url is required' }, 400);

    const config: SourceConfig = {
      url: body.url.trim(),
      format: body.format === 'json' ? 'json' : 'rss',
      ...(body.itemsPath ? { itemsPath: body.itemsPath } : {}),
      ...(body.mapping ? { mapping: body.mapping } : {}),
    };

    const result = await saveSource(db, c.env as Env, {
      tenantId,
      userId: (c.get('userId') as string | undefined) ?? null,
      name: body.name.trim(),
      vendor: (body.vendor ?? 'feed').trim(),
      config,
      apiKey: body.apiKey ?? null,
    });
    if (!result.ok) return c.json({ error: result.reason, detail: result.detail }, 400);
    return c.json(result);
  });

  router.delete('/sources/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid source id' }, 400);
    const removed = await deleteSource(db, tenantId, id);
    return removed ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });

  /**
   * Run one feed now.
   *
   * Answers 200 with the run's own counters even when the feed failed: the
   * operator asked "what happens when you fetch this?", and the answer to that
   * question is a successful response containing a failure, not a 502. The
   * refusals that ARE 4xx here are about the request — an id that is not theirs.
   */
  router.post('/sources/:id/sync', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid source id' }, 400);

    const source = await getSource(db, tenantId, id);
    if (!source) return c.json({ error: 'not_found' }, 404);

    const result = await syncJobSource(db, c.env as Env, {
      id, tenantId, config: { url: source.url, format: source.format, ...source.config },
    });

    // No bump here: `syncJobSource` already did it if the run wrote anything.
    // A second one would be a second place the rule lives.
    return c.json(result);
  });

  return router;
}
