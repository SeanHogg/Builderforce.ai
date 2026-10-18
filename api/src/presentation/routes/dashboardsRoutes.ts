/**
 * Custom Dashboards + AI-Powered Queries — /api/dashboards/*
 *
 * Naming — five "dashboard" paths, five distinct resources (none serves another's
 * data; the near-identical names are history, kept because they are public paths):
 *   /api/dashboard            the manager HOME snapshot + usage attribution (computed)
 *   /api/dashboards           SAVED, editable KPI dashboards and their widgets
 *   /api/dashboard-pins       one member's pinned insight widgets
 *   /api/runtime/dashboard    execution status totals per agent host (live console)
 *   /api/governance/stakeholder-alignment/projects/:id/dashboard
 *                             one project's stakeholder-alignment summary
 *
 * Managers compose SAVED DASHBOARDS from WIDGETS over EXISTING metrics. A widget
 * stores a whitelisted `metric_key` (never SQL); GET /:id/data resolves each key
 * through {@link METRIC_REGISTRY} to a scalar (short-TTL cached). POST /query maps
 * a natural-language question to a whitelisted metric via the deterministic intent
 * parser ({@link answerQuery}) — the LLM is never given a SQL surface.
 *
 *   GET    /                list dashboards (+ widgets)        [member]
 *   POST   /                create dashboard                   [manager]
 *   POST   /presets/:preset materialise a declared preset      [manager]
 *   PATCH  /:id             rename / set default               [manager]
 *   DELETE /:id             delete dashboard (+ widgets)       [manager]
 *   POST   /:id/widgets     add widget                         [manager]
 *   PATCH  /:id/widgets/:w  update widget                      [manager]
 *   DELETE /:id/widgets/:w  remove widget                      [manager]
 *   GET    /:id/data        resolve every widget's metric      [member]
 *   GET    /metrics                    list whitelisted metric keys       [member]
 *   GET    /workforce-health           over-allocated / under-used / idle [member]
 *   POST   /query                      natural-language composed answer   [member]
 *
 * The CRUD rows also answer at the deprecated stuttered `/dashboards/dashboards/*`.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { legacyAliasNotice } from '../middleware/legacyAlias';
import { TenantRole } from '../../domain/shared/types';
import { scope } from './segmentTrackerRoutes';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { METRIC_REGISTRY, listMetricKeys } from '../../application/dashboards/metricRegistry';
import {
  addDashboardWidget,
  createSavedDashboard,
  deleteSavedDashboard,
  listDashboardWidgets,
  listSavedDashboards,
  ownsSavedDashboard,
  recordDashboardQuery,
  removeDashboardWidget,
  updateDashboardWidget,
  updateSavedDashboard,
} from '../../application/dashboards/savedDashboards';
import { metricCacheKey, type MetricCache } from '../../application/dashboards/nlQuery';
import { composeAnswer } from '../../application/dashboards/answerComposer';
import { applyDashboardPreset, isPresetKey, listPresetKeys } from '../../application/dashboards/dashboardPresets';
import { computeWorkforceHealth } from '../../application/dashboards/workforceHealth';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { positiveIntOrNull, daysParam } from './queryParams';
import { gatewayIntentRefiner } from '../../application/dashboards/gatewayIntentRefiner';
import { resolveTenantPlan } from '../../application/tenant/tenantPlanSnapshot';
import type { IntentRefiner } from '../../application/dashboards/nlQuery';
import { parseOptionalBody, z, zNumberLike } from './requestBody';

const SHORT_TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

// Bodies. Free-text fields the handler `.toString()`s / `String()`s accept a number,
// as they always did; required-looking fields stay optional so the handler's own
// "X is required" answer still wins.
const AskQueryBody = z.object({ question: zNumberLike.nullish(), refine: z.boolean().nullish() });
const CreateDashboardBody = z.object({ name: zNumberLike.nullish(), isDefault: z.boolean().nullish() });
const PatchDashboardBody = z.object({ name: z.string().nullish(), isDefault: z.boolean().nullish() });
/** `config` is stored as the widget's JSON document, so it keeps every key. */
const AddWidgetBody = z.object({
  metricKey: zNumberLike.nullish(),
  widgetKey: z.string().nullish(),
  viz: zNumberLike.nullish(),
  title: z.string().nullish(),
  config: z.unknown().optional(),
  position: z.number().nullish(),
});
const PatchWidgetBody = AddWidgetBody.omit({ widgetKey: true });

/**
 * The canonical read-through cache, bound to this request's env, handed to the
 * application layer as a plain function.
 *
 * A composed answer resolves four or five registry metrics for ONE question, each
 * of which is a windowed insight collector — the same expensive reads
 * `GET /:id/data` already caches. They share this helper (and, via
 * {@link metricCacheKey}, the same keys), so a metric warmed by a dashboard render
 * is warm for the Ask box a second later and there is exactly one place to reason
 * about the TTL. The application layer never reaches for infrastructure itself and
 * never grows a private Map+TTL beside this one.
 */
function metricCache(env: Env): MetricCache {
  return (key, loader) => getOrSetCached(env, key, loader, SHORT_TTL);
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
    const body = await parseOptionalBody(c, AskQueryBody);
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
    await recordDashboardQuery(db, { tenantId, question, matchedMetric: lead?.matchedMetric ?? composed.topic, createdBy: createdBy ?? null });

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
    const days = daysParam(c.req.query('days'), 30);
    const result = await getOrSetCached(
      c.env as Env,
      `dashboards:workforce-health:t:${tenantId}:d:${days}`,
      () => computeWorkforceHealth(db, tenantId, days),
      SHORT_TTL,
    );
    return c.json(result);
  });

  // ── Dashboards CRUD ────────────────────────────────────────────────────────
  // ONE sub-router, mounted at the canonical root (`/api/dashboards`, `/api/dashboards/:id`)
  // and at the old stuttered `/api/dashboards/dashboards/*` as a deprecated alias.
  const crud = new Hono<HonoEnv>();
  crud.get('/', async (c) => {
    const { tenantId, segmentId } = scope(c);
    return c.json({ dashboards: await listSavedDashboards(db, tenantId, segmentId) });
  });

  crud.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const body = await parseOptionalBody(c, CreateDashboardBody);
    const createdBy = c.get('userId') as string | undefined;
    const result = await createSavedDashboard(db, { tenantId, segmentId, name: body.name, isDefault: body.isDefault, createdBy: createdBy ?? null });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.row, 201);
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
  crud.post('/presets/:preset', requireRole(TenantRole.MANAGER), async (c) => {
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

  crud.patch('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = positiveIntOrNull(c.req.param('id'));
    if (id == null) return c.json({ error: 'invalid id' }, 400);
    const body = await parseOptionalBody(c, PatchDashboardBody);
    const row = await updateSavedDashboard(db, tenantId, segmentId, id, body);
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });

  crud.delete('/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId, segmentId } = scope(c);
    const id = positiveIntOrNull(c.req.param('id'));
    if (id == null) return c.json({ error: 'invalid id' }, 400);
    const deleted = await deleteSavedDashboard(db, tenantId, segmentId, id);
    if (deleted == null) return c.json({ error: 'not found' }, 404);
    return c.json({ deleted });
  });

  // ── Widget CRUD (scoped to a dashboard the tenant owns) ────────────────────
  crud.post('/:id/widgets', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const dashboardId = positiveIntOrNull(c.req.param('id'));
    if (dashboardId == null) return c.json({ error: 'invalid id' }, 400);
    const body = await parseOptionalBody(c, AddWidgetBody);
    const result = await addDashboardWidget(db, tenantId, dashboardId, body);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.row, 201);
  });

  crud.patch('/:id/widgets/:wid', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const dashboardId = positiveIntOrNull(c.req.param('id'));
    const widgetId = positiveIntOrNull(c.req.param('wid'));
    if (dashboardId == null || widgetId == null) return c.json({ error: 'invalid id' }, 400);
    const body = await parseOptionalBody(c, PatchWidgetBody);
    const result = await updateDashboardWidget(db, tenantId, dashboardId, widgetId, body);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.row);
  });

  crud.delete('/:id/widgets/:wid', requireRole(TenantRole.MANAGER), async (c) => {
    const { tenantId } = scope(c);
    const dashboardId = positiveIntOrNull(c.req.param('id'));
    const widgetId = positiveIntOrNull(c.req.param('wid'));
    if (dashboardId == null || widgetId == null) return c.json({ error: 'invalid id' }, 400);
    const deleted = await removeDashboardWidget(db, tenantId, dashboardId, widgetId);
    if (deleted == null) return c.json({ error: 'not found' }, 404);
    return c.json({ deleted });
  });

  // ── Resolve every widget's metric to a value (short-TTL cached) ────────────
  crud.get('/:id/data', async (c) => {
    const { tenantId } = scope(c);
    const dashboardId = positiveIntOrNull(c.req.param('id'));
    if (dashboardId == null) return c.json({ error: 'invalid id' }, 400);
    if (!(await ownsSavedDashboard(db, tenantId, dashboardId))) return c.json({ error: 'not found' }, 404);

    const widgets = await listDashboardWidgets(db, tenantId, dashboardId);

    const env = c.env as Env;
    const data = await Promise.all(
      widgets.map(async (w) => {
        const cfg = (w.config ?? {}) as { days?: number };
        const days = daysParam(cfg.days != null ? String(cfg.days) : undefined, 30);
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

  router.use('/dashboards/*', legacyAliasNotice((c) => c.req.path.replace(/\/dashboards\/dashboards(?=\/|$)/, '/dashboards')));
  router.route('/', crud);
  router.route('/dashboards', crud);

  return router;
}
