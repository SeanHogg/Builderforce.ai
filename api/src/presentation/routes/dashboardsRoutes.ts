import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
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
 *   POST   /dashboards/presets/:preset materialise a declared preset      [manager]
 *   PATCH  /dashboards/:id             rename / set default               [manager]
 *   DELETE /dashboards/:id             delete dashboard (+ widgets)       [manager]
 *   POST   /dashboards/:id/widgets     add widget                         [manager]
 *   PATCH  /dashboards/:id/widgets/:w  update widget                      [manager]
 *   DELETE /dashboards/:id/widgets/:w  remove widget                      [manager]
 *   GET    /dashboards/:id/data        resolve every widget's metric      [member]
 *   GET    /metrics                    list whitelisted metric keys       [member]
 *   GET    /workforce-health           over-allocated / under-used / idle [member]
 *   POST   /query                      natural-language composed answer   [member]
 */

import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { dashboardWidgets, savedDashboards, savedQueries } from '../../infrastructure/database/schema';
import { METRIC_REGISTRY, isMetricKey, listMetricKeys } from '../../application/dashboards/metricRegistry';
import { metricCacheKey, type MetricCache } from '../../application/dashboards/nlQuery';
import { composeAnswer } from '../../application/dashboards/answerComposer';
import { applyDashboardPreset, isPresetKey, listPresetKeys } from '../../application/dashboards/dashboardPresets';
import { computeWorkforceHealth } from '../../application/dashboards/workforceHealth';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { positiveIntOrNull } from './queryParams';
import { gatewayIntentRefiner } from '../../application/dashboards/gatewayIntentRefiner';
import { resolveTenantPlan } from './llmRoutes';
import type { IntentRefiner } from '../../application/dashboards/nlQuery';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/**
 * The canonical read-through cache, bound to this request's env, handed to the
 * application layer as a plain function.
 *
 * A composed answer resolves four or five registry metrics for ONE question, each
 * of which is a windowed insight collector — the same expensive reads
 * `GET /dashboards/:id/data` already caches. They share this helper (and, via
 * {@link metricCacheKey}, the same keys), so a metric warmed by a dashboard render
 * is warm for the Ask box a second later and there is exactly one place to reason
 * about the TTL. The application layer never reaches for infrastructure itself and
 * never grows a private Map+TTL beside this one.
 */
function metricCache(env: Env): MetricCache {
  return (key, loader) => getOrSetCached(env, key, loader, SHORT_TTL);
}

/** Clamp a `?days=` window to a sane range (default 30). */
function parseDays(raw: string | undefined, def = 30): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.floor(n) : def;
}


const ALLOWED_VIZ = new Set(['stat', 'bar', 'line', 'gauge', 'widget']);

/** A registry widget id (rich client-rendered card); opaque + length-bound. */
function cleanWidgetKey(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s.length >= 1 && s.length <= 96 ? s : null;
}

export function createDashboardsRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── Whitelisted metric catalogue (drives the widget picker) ────────────────
  router.get('/metrics', async (c) => {
    const metrics = listMetricKeys()
      .map((key) => {
        const def = METRIC_REGISTRY[key];
        return def ? { key, label: def.label, unit: def.unit, description: def.description, goodWhenUp: def.goodWhenUp ?? null } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    return c.json({ metrics });
  });

  // ── AI-Powered Query (deterministic NL → composed, whitelisted answer) ─────
  //
  // The keyword classifiers answer first and answer alone whenever they recognise
  // the question — as a TOPIC (a whole situation: several metrics plus the widgets
  // that draw them) or, failing that, as a single metric. Only a question NEITHER
  // recognises reaches the gateway refiner, which may pick a different WHITELISTED
  // topic or key and nothing else — so this stays a deterministic feature that an
  // LLM sometimes improves, not an LLM feature with a deterministic fallback.
  // `refine: false` opts out entirely.
  //
  // The response carries the composed shape AND the original single-metric fields,
  // populated from `metrics[0]`: every existing client reads `.value` /
  // `.explanation` / `.matchedMetric` and must keep working unchanged.
  router.post('/query', async (c) => {
    const { tenantId } = scope(c);
    const body = await c.req.json<{ question?: string; refine?: boolean }>().catch(() => ({}) as { question?: string; refine?: boolean });
    const question = (body.question ?? '').toString().trim();
    if (!question) return c.json({ error: 'question is required' }, 400);

    let refiner: IntentRefiner | undefined;
    if (body.refine !== false) {
      // A plan lookup failure means no refiner, not a failed query.
      const plan = await resolveTenantPlan(c.env as Env, tenantId).catch(() => null);
      if (plan) refiner = gatewayIntentRefiner(c.env as Env, plan.effectivePlan, plan.premiumOverride);
    }

    const composed = await composeAnswer(db, tenantId, question, { refiner, cache: metricCache(c.env as Env) });
    // metrics[] is never empty (a topic declares its keys; the metric path returns
    // one), but the fallback keeps a shape change from becoming a 500.
    const lead = composed.metrics[0];

    // Record the question + matched metric for history/audit (best-effort).
    const createdBy = c.get('userId') as string | undefined;
    try {
      await db.insert(savedQueries).values({
        tenantId,
        question,
        matchedMetric: lead?.matchedMetric ?? composed.topic,
        createdBy: createdBy ?? null,
      });
    } catch (error) { /* history is non-critical */
      reportCaughtError(error, { source: "presentation/routes/dashboardsRoutes.ts", operation: "createDashboardsRoutes" });
    }

    return c.json({
      matchedMetric: lead?.matchedMetric ?? '',
      label: lead?.label ?? '',
      value: lead?.value ?? null,
      unit: lead?.unit ?? '',
      explanation: lead?.explanation ?? composed.narrative,
      ...composed,
    });
  });

  // ── Workforce health (the three cohorts, one read) ─────────────────────────
  //
  // The rows behind `people.overAllocated` / `people.underUtilised` / `people.idle`
  // — the scalars answer "how many", this answers "who". Member-visible: a manager
  // needing to rebalance and a member checking their own load read the same thing.
  router.get('/workforce-health', async (c) => {
    const { tenantId } = scope(c);
    const days = parseDays(c.req.query('days'));
    const result = await getOrSetCached(
      c.env as Env,
      `dashboards:workforce-health:t:${tenantId}:d:${days}`,
      () => computeWorkforceHealth(db, tenantId, days),
      SHORT_TTL,
    );
    return c.json(result);
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

  // ── Presets: a curated dashboard a manager gets by asking ──────────────────
  //
  // Manager-gated like every other dashboard WRITE — it materialises real
  // `saved_dashboards` + `dashboard_widgets` rows, so it is a create, not a read
  // with a nice name. Idempotent: re-applying reconciles against what is already
  // there rather than duplicating tiles (see applyDashboardPreset).
  //
  // Declared BEFORE `/dashboards/:id` writes only in reading order; Hono matches
  // the literal `presets` segment ahead of `:id` regardless, and an id is
  // numeric-only so the two can never collide.
  router.post('/dashboards/presets/:preset', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const preset = c.req.param('preset');
    // THE GATE: a path segment names a preset only if the preset table declares it.
    if (!isPresetKey(preset)) {
      return c.json({ error: 'unknown preset', presets: listPresetKeys() }, 400);
    }
    const createdBy = c.get('userId') as string | undefined;
    const result = await applyDashboardPreset(db, tenantId, segmentId, preset, createdBy ?? null);
    return c.json(result, result.createdDashboard ? 201 : 200);
  });

  router.patch('/dashboards/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = positiveIntOrNull(c.req.param('id'));
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
    const id = positiveIntOrNull(c.req.param('id'));
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
    const dashboardId = positiveIntOrNull(c.req.param('id'));
    if (dashboardId == null) return c.json({ error: 'invalid id' }, 400);
    if (!(await ownsDashboard(tenantId, dashboardId))) return c.json({ error: 'not found' }, 404);

    const body = await c.req.json<{ metricKey?: string; widgetKey?: string; viz?: string; title?: string; config?: unknown; position?: number }>().catch(() => ({}) as { metricKey?: string; widgetKey?: string; viz?: string; title?: string; config?: unknown; position?: number });
    // A widget is EITHER a rich registry widget (widgetKey) OR a scalar metric.
    const widgetKey = cleanWidgetKey(body.widgetKey);
    const metricKey = widgetKey ? null : (body.metricKey ?? '').toString();
    if (!widgetKey && !isMetricKey(metricKey as string)) return c.json({ error: 'widgetKey or a valid metric_key is required' }, 400);
    const viz = widgetKey ? 'widget' : (ALLOWED_VIZ.has(String(body.viz)) ? String(body.viz) : 'stat');
    const config: Record<string, unknown> = body.config && typeof body.config === 'object' ? (body.config as Record<string, unknown>) : {};
    const position = Number.isFinite(body.position) ? Math.floor(body.position as number) : 0;

    const [row] = await db
      .insert(dashboardWidgets)
      .values({
        tenantId,
        dashboardId,
        metricKey,
        widgetKey,
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
    const dashboardId = positiveIntOrNull(c.req.param('id'));
    const widgetId = positiveIntOrNull(c.req.param('wid'));
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
    const dashboardId = positiveIntOrNull(c.req.param('id'));
    const widgetId = positiveIntOrNull(c.req.param('wid'));
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
    const dashboardId = positiveIntOrNull(c.req.param('id'));
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
        const cfg = (w.config ?? {}) as { days?: number };
        const days = parseDays(cfg.days != null ? String(cfg.days) : undefined);
        // Registry widgets render client-side from the widget registry — no server
        // metric to resolve. Hand back the key so the client renders the card.
        if (w.widgetKey) {
          return { widgetId: w.id, widgetKey: w.widgetKey, metricKey: null, title: w.title, viz: 'widget', value: null, unit: '', label: w.title ?? w.widgetKey, days, series: null };
        }
        const def = w.metricKey ? METRIC_REGISTRY[w.metricKey] : undefined;
        if (!def) {
          return { widgetId: w.id, widgetKey: null, metricKey: w.metricKey, title: w.title, viz: w.viz, value: null, unit: '', label: w.metricKey ?? '', days, series: null, error: 'unknown metric' };
        }
        // Same key builder the Ask box uses, so one warm entry serves both.
        const key = metricCacheKey(tenantId, w.metricKey as string, days);
        const value = await getOrSetCached(env, key, () => def.compute(db, tenantId, days), SHORT_TTL);
        // Date-windowed trend (sparkline/line/bar source), cached alongside the
        // scalar. Absent for point-in-time metrics → widget renders scalar-only.
        const series = def.series
          ? await getOrSetCached(env, `${key}:series`, () => def.series!(db, tenantId, days), SHORT_TTL)
          : null;
        return { widgetId: w.id, widgetKey: null, metricKey: w.metricKey, title: w.title ?? def.label, viz: w.viz, value, unit: def.unit, label: def.label, days, series, goodWhenUp: def.goodWhenUp ?? null };
      }),
    );

    return c.json({ dashboardId, widgets: data });
  });

  return router;
}
