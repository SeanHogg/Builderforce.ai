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
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { syncJobSource } from '../../application/sourcing/runSourcingSweep';
import { listSourcedListings } from '../../application/sourcing/sourcingListings';
import {
  deleteSource, getSource, listSources, saveSource, type SourceConfig,
} from '../../application/sourcing/sourcingSources';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

interface NewSourceBody {
  name?: string;
  vendor?: string;
  url?: string;
  format?: string;
  itemsPath?: string;
  mapping?: Record<string, string>;
  apiKey?: string;
}

export function createSourcingRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── Listings ────────────────────────────────────────────────────────────
  //
  // The read itself — projection, filter, cache and version token — belongs to
  // `listSourcedListings`; the handler's only job is turning a request into its
  // arguments. Everything about WHAT a listing is lives in one place.
  router.get('/listings', async (c) => {
    const rows = await listSourcedListings(db, c.env as Env, {
      tenantId: c.get('tenantId') as number,
      q: c.req.query('q'),
      limit: Number(c.req.query('limit') ?? 50),
    });
    return c.json({ rows });
  });

  // ── Sources ─────────────────────────────────────────────────────────────
  router.get('/sources', requireRole(TenantRole.MANAGER), async (c) => {
    return c.json({ rows: await listSources(db, c.get('tenantId') as number) });
  });

  router.post('/sources', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    // The fallback is TYPED, not a bare `{}`: an untyped one widens the union and
    // every field access below becomes an error on the empty branch.
    const body = await c.req.json<NewSourceBody>().catch((): NewSourceBody => ({}));

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
