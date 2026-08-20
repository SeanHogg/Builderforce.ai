/**
 * Per-user widget pins — /api/dashboard-pins/*
 *
 * A pin is a member's personal favourite: the registry widget id they want on
 * their own /insights home dashboard, scoped to (tenant, user). No manager gate —
 * pinning is a personal action that touches only the caller's own rows.
 *
 *   GET    /                list the caller's pins (ordered)        [member]
 *   POST   /                pin a widget (append)                   [member]
 *   DELETE /:widgetKey      unpin a widget                          [member]
 *   PUT    /order           reorder pins                            [member]
 *
 * The rows, the read-through cache and its invalidation live in
 * `application/dashboards/dashboardPins.ts`.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/authMiddleware';
import { scope } from './segmentTrackerRoutes';
import {
  addPin, cleanWidgetKey, listPins, removePin, reorderPins,
} from '../../application/dashboards/dashboardPins';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

export function createDashboardPinsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── List ───────────────────────────────────────────────────────────────────
  router.get('/', async (c) => {
    const { tenantId } = scope(c);
    const uid = c.get('userId') as string | undefined;
    if (!uid) return c.json({ pins: [] });
    return c.json({ pins: await listPins(db, c.env as Env, tenantId, uid) });
  });

  // ── Pin (append at end) ──────────────────────────────────────────────────────
  router.post('/', async (c) => {
    const { tenantId } = scope(c);
    const uid = c.get('userId') as string | undefined;
    if (!uid) return c.json({ error: 'no user' }, 401);
    const body = await c.req.json<{ widgetKey?: string }>().catch(() => ({}) as { widgetKey?: string });
    const widgetKey = cleanWidgetKey(body.widgetKey);
    if (!widgetKey) return c.json({ error: 'widgetKey is required' }, 400);
    return c.json(await addPin(db, c.env as Env, tenantId, uid, widgetKey), 201);
  });

  // ── Unpin ────────────────────────────────────────────────────────────────────
  router.delete('/:widgetKey', async (c) => {
    const { tenantId } = scope(c);
    const uid = c.get('userId') as string | undefined;
    if (!uid) return c.json({ error: 'no user' }, 401);
    const widgetKey = cleanWidgetKey(decodeURIComponent(c.req.param('widgetKey')));
    if (!widgetKey) return c.json({ error: 'invalid widgetKey' }, 400);
    await removePin(db, c.env as Env, tenantId, uid, widgetKey);
    return c.json({ deleted: widgetKey });
  });

  // ── Reorder ──────────────────────────────────────────────────────────────────
  router.put('/order', async (c) => {
    const { tenantId } = scope(c);
    const uid = c.get('userId') as string | undefined;
    if (!uid) return c.json({ error: 'no user' }, 401);
    const body = await c.req.json<{ order?: unknown }>().catch(() => ({}) as { order?: unknown });
    const order = Array.isArray(body.order)
      ? body.order.map((k) => cleanWidgetKey(k)).filter((k): k is string => k !== null)
      : [];
    return c.json({ pins: await reorderPins(db, c.env as Env, tenantId, uid, order) });
  });

  return router;
}
