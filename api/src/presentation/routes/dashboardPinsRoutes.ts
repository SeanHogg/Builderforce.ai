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
 * The list read is served through the read-through cache and invalidated on every
 * write so a member's home loads without a round-trip per visit.
 */

import { Hono } from 'hono';
import { and, asc, eq, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/authMiddleware';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { dashboardPins } from '../../infrastructure/database/schema';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const PINS_TTL = { kvTtlSeconds: 120, l1TtlMs: 30_000 };

function pinsKey(tenantId: number, userId: string): string {
  return `dashboard-pins:t:${tenantId}:u:${userId}`;
}

/** A widget id is an opaque registry key (validated client-side); bound length. */
function cleanKey(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s.length >= 1 && s.length <= 96 ? s : null;
}

export function createDashboardPinsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  async function loadPins(tenantId: number, userId: string) {
    return db
      .select({ widgetKey: dashboardPins.widgetKey, position: dashboardPins.position })
      .from(dashboardPins)
      .where(and(eq(dashboardPins.tenantId, tenantId), eq(dashboardPins.userId, userId)))
      .orderBy(asc(dashboardPins.position), asc(dashboardPins.id));
  }

  // ── List ───────────────────────────────────────────────────────────────────
  router.get('/', async (c) => {
    const { tenantId } = scope(c);
    const uid = c.get('userId') as string | undefined;
    if (!uid) return c.json({ pins: [] });
    const env = c.env as Env;
    const pins = await getOrSetCached(env, pinsKey(tenantId, uid), () => loadPins(tenantId, uid), PINS_TTL);
    return c.json({ pins });
  });

  // ── Pin (append at end) ──────────────────────────────────────────────────────
  router.post('/', async (c) => {
    const { tenantId } = scope(c);
    const uid = c.get('userId') as string | undefined;
    if (!uid) return c.json({ error: 'no user' }, 401);
    const body = await c.req.json<{ widgetKey?: string }>().catch(() => ({}) as { widgetKey?: string });
    const widgetKey = cleanKey(body.widgetKey);
    if (!widgetKey) return c.json({ error: 'widgetKey is required' }, 400);

    const maxRows = await db
      .select({ max: sql<number>`coalesce(max(${dashboardPins.position}), -1)` })
      .from(dashboardPins)
      .where(and(eq(dashboardPins.tenantId, tenantId), eq(dashboardPins.userId, uid)));
    const position = Number(maxRows[0]?.max ?? -1) + 1;

    const [row] = await db
      .insert(dashboardPins)
      .values({ tenantId, userId: uid, widgetKey, position })
      .onConflictDoNothing()
      .returning({ widgetKey: dashboardPins.widgetKey, position: dashboardPins.position });

    await invalidateCached(c.env as Env, pinsKey(tenantId, uid));
    return c.json(row ?? { widgetKey, position }, 201);
  });

  // ── Unpin ────────────────────────────────────────────────────────────────────
  router.delete('/:widgetKey', async (c) => {
    const { tenantId } = scope(c);
    const uid = c.get('userId') as string | undefined;
    if (!uid) return c.json({ error: 'no user' }, 401);
    const widgetKey = cleanKey(decodeURIComponent(c.req.param('widgetKey')));
    if (!widgetKey) return c.json({ error: 'invalid widgetKey' }, 400);
    await db
      .delete(dashboardPins)
      .where(and(eq(dashboardPins.tenantId, tenantId), eq(dashboardPins.userId, uid), eq(dashboardPins.widgetKey, widgetKey)));
    await invalidateCached(c.env as Env, pinsKey(tenantId, uid));
    return c.json({ deleted: widgetKey });
  });

  // ── Reorder ──────────────────────────────────────────────────────────────────
  router.put('/order', async (c) => {
    const { tenantId } = scope(c);
    const uid = c.get('userId') as string | undefined;
    if (!uid) return c.json({ error: 'no user' }, 401);
    const body = await c.req.json<{ order?: unknown }>().catch(() => ({}) as { order?: unknown });
    const order = Array.isArray(body.order)
      ? body.order.map((k) => cleanKey(k)).filter((k): k is string => k !== null)
      : [];
    // Apply positions in the given order (small set; sequential is fine on neon-http).
    let i = 0;
    for (const key of order) {
      await db
        .update(dashboardPins)
        .set({ position: i })
        .where(and(eq(dashboardPins.tenantId, tenantId), eq(dashboardPins.userId, uid), eq(dashboardPins.widgetKey, key)));
      i++;
    }
    await invalidateCached(c.env as Env, pinsKey(tenantId, uid));
    const pins = await loadPins(tenantId, uid);
    return c.json({ pins });
  });

  return router;
}
