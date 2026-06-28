/**
 * Custom Dashboards + AI-Powered Queries — /api/dashboards/*
 *
 * Managers compose SAVED DASHBOARDS from WIDGETS over EXISTING metrics. A widget
 * stores a whitelisted `metric_key` (never SQL); GET /:id/data resolves each key
 * through {@link METRIC_REGISTRY} to a scalar (short-TTL cached). POST /query maps
 * a natural-language question to a whitelisted metric via the deterministic intent
 * parser ({@link answerQuery}) — the LLM is never given a SQL surface.
 *
 *   GET    /dashboards                 list dashboards (+ widgets)        [member]
 *   POST   /dashboards                 create dashboard                   [manager]
 *   PATCH  /dashboards/:id             rename / set default               [manager]
 *   DELETE /dashboards/:id             delete dashboard (+ widgets)       [manager]
 *   POST   /dashboards/:id/widgets     add widget                         [manager]
 *   PATCH  /dashboards/:id/widgets/:w  update widget                      [manager]
 *   DELETE /dashboards/:id/widgets/:w  remove widget                      [manager]
 *   GET    /dashboards/:id/data        resolve every widget's metric      [member]
 *   GET    /metrics                    list whitelisted metric keys       [member]
 *   POST   /query                      natural-language metric query      [member]
 */

import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { dashboardWidgets, savedDashboards, savedQueries } from '../../infrastructure/database/schema';
import { METRIC_REGISTRY, isMetricKey, listMetricKeys } from '../../application/dashboards/metricRegistry';
import { answerQuery } from '../../application/dashboards/nlQuery';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** Clamp a `?days=` window to a sane range (default 30). */
function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}

/** Parse a positive-integer route param, else null. */
function parseIntParam(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const ALLOWED_VIZ = new Set(['stat', 'bar', 'line', 'gauge']);

export function createDashboardsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── Whitelisted metric catalogue (drives the widget picker) ────────────────
  router.get('/metrics', async (c) => {
    const metrics = listMetricKeys()
      .map((key) => {
        const def = METRIC_REGISTRY[key];
        return def ? { key, label: def.label, unit: def.unit, description: def.description } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    return c.json({ metrics });
  });

  // ── AI-Powered Query (deterministic NL → whitelisted metric) ───────────────
  router.post('/query', async (c) => {
    const { tenantId } = scope(c);
    const body = await c.req.json<{ question?: string }>().catch(() => ({}) as { question?: string });
    const question = (body.question ?? '').toString().trim();
    if (!question) return c.json({ error: 'question is required' }, 400);

    const answer = await answerQuery(db, tenantId, question);

    // Record the question + matched metric for history/audit (best-effort).
    const createdBy = c.get('userId') as string | undefined;
    try {
      await db.insert(savedQueries).values({
        tenantId,
        question,
        matchedMetric: answer.matchedMetric,
        createdBy: createdBy ?? null,
      });
    } catch { /* history is non-critical */ }

    return c.json(answer);
  });

  // ── Dashboards CRUD ────────────────────────────────────────────────────────
  router.get('/dashboards', async (c) => {
    const { tenantId, segmentId } = scope(c);
    const dashboards = await db
      .select()
      .from(savedDashboards)
      .where(and(eq(savedDashboards.tenantId, tenantId), eq(savedDashboards.segmentId, segmentId)))
      .orderBy(asc(savedDashboards.id));
    const ids = dashboards.map((d) => d.id);
    const widgets = ids.length
      ? await db
          .select()
          .from(dashboardWidgets)
          .where(eq(dashboardWidgets.tenantId, tenantId))
          .orderBy(asc(dashboardWidgets.position), asc(dashboardWidgets.id))
      : [];
    const byDash = new Map<number, typeof widgets>();
    for (const w of widgets) {
      if (!ids.includes(w.dashboardId)) continue;
      const list = byDash.get(w.dashboardId) ?? [];
      list.push(w);
      byDash.set(w.dashboardId, list);
    }
    return c.json({ dashboards: dashboards.map((d) => ({ ...d, widgets: byDash.get(d.id) ?? [] })) });
  });

  router.post('/dashboards', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await c.req.json<{ name?: string; isDefault?: boolean }>().catch(() => ({}) as { name?: string; isDefault?: boolean });
    const name = (body.name ?? '').toString().trim();
    if (!name) return c.json({ error: 'name is required' }, 400);
    const createdBy = c.get('userId') as string | undefined;
    const [row] = await db
      .insert(savedDashboards)
      .values({ tenantId, segmentId, name, isDefault: !!body.isDefault, createdBy: createdBy ?? null })
      .returning();
    return c.json({ ...row, widgets: [] }, 201);
  });

  router.patch('/dashboards/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = parseIntParam(c.req.param('id'));
    if (id == null) return c.json({ error: 'invalid id' }, 400);
    const body = await c.req.json<{ name?: string; isDefault?: boolean }>().catch(() => ({}) as { name?: string; isDefault?: boolean });
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.isDefault === 'boolean') patch.isDefault = body.isDefault;
    const [row] = await db
      .update(savedDashboards)
      .set(patch)
      .where(and(eq(savedDashboards.id, id), eq(savedDashboards.tenantId, tenantId), eq(savedDashboards.segmentId, segmentId)))
      .returning();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });

  router.delete('/dashboards/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = parseIntParam(c.req.param('id'));
    if (id == null) return c.json({ error: 'invalid id' }, 400);
    const [row] = await db
      .delete(savedDashboards)
      .where(and(eq(savedDashboards.id, id), eq(savedDashboards.tenantId, tenantId), eq(savedDashboards.segmentId, segmentId)))
      .returning();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ deleted: row.id });
  });

  // ── Widget CRUD (scoped to a dashboard the tenant owns) ────────────────────
  async function ownsDashboard(tenantId: number, dashboardId: number): Promise<boolean> {
    const [d] = await db
      .select({ id: savedDashboards.id })
      .from(savedDashboards)
      .where(and(eq(savedDashboards.id, dashboardId), eq(savedDashboards.tenantId, tenantId)));
    return !!d;
  }

  router.post('/dashboards/:id/widgets', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const dashboardId = parseIntParam(c.req.param('id'));
    if (dashboardId == null) return c.json({ error: 'invalid id' }, 400);
    if (!(await ownsDashboard(tenantId, dashboardId))) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<{ metricKey?: string; viz?: string; title?: string; config?: unknown; position?: number }>().catch(() => ({}) as { metricKey?: string; viz?: string; title?: string; config?: unknown; position?: number });
    const metricKey = (body.metricKey ?? '').toString();
    if (!isMetricKey(metricKey)) return c.json({ error: 'unknown metric_key' }, 400);
    const viz = ALLOWED_VIZ.has(String(body.viz)) ? String(body.viz) : 'stat';
    const config = body.config && typeof body.config === 'object' ? body.config : {};
    const position = Number.isFinite(body.position) ? Math.floor(body.position as number) : 0;

    const [row] = await db
      .insert(dashboardWidgets)
      .values({
        tenantId,
        dashboardId,
        metricKey,
        viz,
        title: typeof body.title === 'string' ? body.title.slice(0, 160) : null,
        config,
        position,
      })
      .returning();
    return c.json(row, 201);
  });

  router.patch('/dashboards/:id/widgets/:wid', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const dashboardId = parseIntParam(c.req.param('id'));
    const widgetId = parseIntParam(c.req.param('wid'));
    if (dashboardId == null || widgetId == null) return c.json({ error: 'invalid id' }, 400);

    const body = await c.req.json<{ metricKey?: string; viz?: string; title?: string; config?: unknown; position?: number }>().catch(() => ({}) as { metricKey?: string; viz?: string; title?: string; config?: unknown; position?: number });
    const patch: Record<string, unknown> = {};
    if (body.metricKey !== undefined) {
      if (!isMetricKey(String(body.metricKey))) return c.json({ error: 'unknown metric_key' }, 400);
      patch.metricKey = String(body.metricKey);
    }
    if (body.viz !== undefined) patch.viz = ALLOWED_VIZ.has(String(body.viz)) ? String(body.viz) : 'stat';
    if (typeof body.title === 'string') patch.title = body.title.slice(0, 160);
    if (body.config && typeof body.config === 'object') patch.config = body.config;
    if (Number.isFinite(body.position)) patch.position = Math.floor(body.position as number);
    if (Object.keys(patch).length === 0) return c.json({ error: 'nothing to update' }, 400);

    const [row] = await db
      .update(dashboardWidgets)
      .set(patch)
      .where(and(eq(dashboardWidgets.id, widgetId), eq(dashboardWidgets.dashboardId, dashboardId), eq(dashboardWidgets.tenantId, tenantId)))
      .returning();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });

  router.delete('/dashboards/:id/widgets/:wid', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const dashboardId = parseIntParam(c.req.param('id'));
    const widgetId = parseIntParam(c.req.param('wid'));
    if (dashboardId == null || widgetId == null) return c.json({ error: 'invalid id' }, 400);
    const [row] = await db
      .delete(dashboardWidgets)
      .where(and(eq(dashboardWidgets.id, widgetId), eq(dashboardWidgets.dashboardId, dashboardId), eq(dashboardWidgets.tenantId, tenantId)))
      .returning();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ deleted: row.id });
  });

  // ── Resolve every widget's metric to a value (short-TTL cached) ────────────
  router.get('/dashboards/:id/data', async (c) => {
    const { tenantId } = scope(c);
    const dashboardId = parseIntParam(c.req.param('id'));
    if (dashboardId == null) return c.json({ error: 'invalid id' }, 400);
    if (!(await ownsDashboard(tenantId, dashboardId))) return c.json({ error: 'not found' }, 404);

    const widgets = await db
      .select()
      .from(dashboardWidgets)
      .where(and(eq(dashboardWidgets.dashboardId, dashboardId), eq(dashboardWidgets.tenantId, tenantId)))
      .orderBy(asc(dashboardWidgets.position), asc(dashboardWidgets.id));

    const env = c.env as Env;
    const data = await Promise.all(
      widgets.map(async (w) => {
        const def = METRIC_REGISTRY[w.metricKey];
        const cfg = (w.config ?? {}) as { days?: number };
        const days = parseDays(cfg.days != null ? String(cfg.days) : undefined);
        if (!def) {
          return { widgetId: w.id, metricKey: w.metricKey, title: w.title, viz: w.viz, value: null, unit: '', label: w.metricKey, days, error: 'unknown metric' };
        }
        const key = `dashboards:metric:t:${tenantId}:k:${w.metricKey}:d:${days}`;
        const value = await getOrSetCached(env, key, () => def.compute(db, tenantId, days), SHORT_TTL);
        return { widgetId: w.id, metricKey: w.metricKey, title: w.title ?? def.label, viz: w.viz, value, unit: def.unit, label: def.label, days };
      }),
    );

    return c.json({ dashboardId, widgets: data });
  });

  return router;
}
