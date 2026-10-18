/**
 * Saved dashboards + their widgets — THE CRUD for `saved_dashboards` /
 * `dashboard_widgets`.
 *
 * Extracted from `presentation/routes/dashboardsRoutes.ts` so the HTTP routes and the
 * Brain's `dashboards.*` MCP tools (`builtinMcpService.ts`) write the same rows with the
 * same rules: one whitelist for metric keys and viz, one ownership check, one list
 * order. Dashboards are segment-scoped; widgets are tenant-scoped through their parent
 * dashboard (deleting a dashboard cascades its widgets at the FK).
 *
 * Validation failures come back as a {@link DashboardWriteResult} rather than a throw so
 * the route maps them to its status codes and the MCP tool to its error message.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { dashboardWidgets, savedDashboards, savedQueries } from '../../infrastructure/database/schema';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { isMetricKey } from './metricRegistry';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export type SavedDashboardRow = typeof savedDashboards.$inferSelect;
export type DashboardWidgetRow = typeof dashboardWidgets.$inferSelect;
export type SavedDashboardWithWidgets = SavedDashboardRow & { widgets: DashboardWidgetRow[] };

export type DashboardWriteResult<T> =
  | { ok: true; row: T }
  | { ok: false; status: 400 | 404; error: string };

/** The viz values a widget may carry; anything else falls back to `stat`. */
export const ALLOWED_VIZ = new Set(['stat', 'bar', 'line', 'gauge', 'widget']);

function normaliseViz(raw: unknown): string {
  return ALLOWED_VIZ.has(String(raw)) ? String(raw) : 'stat';
}

/** A registry widget id (rich client-rendered card); opaque + length-bound. */
export function cleanWidgetKey(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s.length >= 1 && s.length <= 96 ? s : null;
}

/** Every dashboard in the segment, oldest first, each with its widgets in position order. */
export async function listSavedDashboards(db: Db, tenantId: number, segmentId: string): Promise<SavedDashboardWithWidgets[]> {
  const dashboards = await db
    .select()
    .from(savedDashboards)
    .where(and(eq(savedDashboards.tenantId, tenantId), eq(savedDashboards.segmentId, segmentId)))
    .orderBy(asc(savedDashboards.id)).limit(LIST_ROW_CAP);
  if (dashboards.length === 0) return [];
  const ids = new Set(dashboards.map((d) => d.id));
  const widgets = await db
    .select()
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.tenantId, tenantId))
    .orderBy(asc(dashboardWidgets.position), asc(dashboardWidgets.id)).limit(LIST_ROW_CAP);
  const byDash = new Map<number, DashboardWidgetRow[]>();
  for (const w of widgets) {
    if (!ids.has(w.dashboardId)) continue;
    const list = byDash.get(w.dashboardId) ?? [];
    list.push(w);
    byDash.set(w.dashboardId, list);
  }
  return dashboards.map((d) => ({ ...d, widgets: byDash.get(d.id) ?? [] }));
}

export async function createSavedDashboard(
  db: Db,
  input: { tenantId: number; segmentId: string; name: unknown; isDefault?: boolean | null; createdBy?: string | null },
): Promise<DashboardWriteResult<SavedDashboardWithWidgets>> {
  const name = (input.name ?? '').toString().trim();
  if (!name) return { ok: false, status: 400, error: 'name is required' };
  const [row] = await db
    .insert(savedDashboards)
    .values({ tenantId: input.tenantId, segmentId: input.segmentId, name, isDefault: !!input.isDefault, createdBy: input.createdBy ?? null })
    .returning();
  return { ok: true, row: { ...row!, widgets: [] } };
}

/** Rename and/or set default. Null when the dashboard is not in this tenant + segment. */
export async function updateSavedDashboard(
  db: Db,
  tenantId: number,
  segmentId: string,
  id: number,
  input: { name?: string | null; isDefault?: boolean | null },
): Promise<SavedDashboardRow | null> {
  const patch: Partial<typeof savedDashboards.$inferInsert> = { updatedAt: new Date() };
  if (typeof input.name === 'string' && input.name.trim()) patch.name = input.name.trim();
  if (typeof input.isDefault === 'boolean') patch.isDefault = input.isDefault;
  const [row] = await db
    .update(savedDashboards)
    .set(patch)
    .where(and(eq(savedDashboards.id, id), eq(savedDashboards.tenantId, tenantId), eq(savedDashboards.segmentId, segmentId)))
    .returning();
  return row ?? null;
}

/** Delete a dashboard (its widgets cascade). Returns the deleted id, or null when not found. */
export async function deleteSavedDashboard(db: Db, tenantId: number, segmentId: string, id: number): Promise<number | null> {
  const [row] = await db
    .delete(savedDashboards)
    .where(and(eq(savedDashboards.id, id), eq(savedDashboards.tenantId, tenantId), eq(savedDashboards.segmentId, segmentId)))
    .returning({ id: savedDashboards.id });
  return row?.id ?? null;
}

/** Does this tenant own the dashboard? The gate in front of every widget write and data read. */
export async function ownsSavedDashboard(db: Db, tenantId: number, dashboardId: number): Promise<boolean> {
  const [d] = await db
    .select({ id: savedDashboards.id })
    .from(savedDashboards)
    .where(and(eq(savedDashboards.id, dashboardId), eq(savedDashboards.tenantId, tenantId)))
    .limit(1);
  return !!d;
}

/** One dashboard's widgets, in render order. */
export async function listDashboardWidgets(db: Db, tenantId: number, dashboardId: number): Promise<DashboardWidgetRow[]> {
  return db
    .select()
    .from(dashboardWidgets)
    .where(and(eq(dashboardWidgets.dashboardId, dashboardId), eq(dashboardWidgets.tenantId, tenantId)))
    .orderBy(asc(dashboardWidgets.position), asc(dashboardWidgets.id));
}

export interface WidgetInput {
  metricKey?: unknown;
  widgetKey?: unknown;
  viz?: unknown;
  title?: unknown;
  config?: unknown;
  position?: unknown;
}

/** Add a widget: EITHER a rich registry widget (widgetKey) OR a whitelisted scalar metric. */
export async function addDashboardWidget(
  db: Db,
  tenantId: number,
  dashboardId: number,
  input: WidgetInput,
): Promise<DashboardWriteResult<DashboardWidgetRow>> {
  if (!(await ownsSavedDashboard(db, tenantId, dashboardId))) return { ok: false, status: 404, error: 'not found' };
  const widgetKey = cleanWidgetKey(input.widgetKey);
  const metricKey = widgetKey ? null : (input.metricKey ?? '').toString();
  if (!widgetKey && !isMetricKey(metricKey as string)) return { ok: false, status: 400, error: 'widgetKey or a valid metric_key is required' };
  const viz = widgetKey ? 'widget' : normaliseViz(input.viz);
  const config: Record<string, unknown> = input.config && typeof input.config === 'object' ? (input.config as Record<string, unknown>) : {};
  const position = typeof input.position === 'number' && Number.isFinite(input.position) ? Math.floor(input.position) : 0;
  const [row] = await db
    .insert(dashboardWidgets)
    .values({
      tenantId,
      dashboardId,
      metricKey,
      widgetKey,
      viz,
      title: typeof input.title === 'string' ? input.title.slice(0, 160) : null,
      config,
      position,
    })
    .returning();
  return { ok: true, row: row! };
}

export async function updateDashboardWidget(
  db: Db,
  tenantId: number,
  dashboardId: number,
  widgetId: number,
  input: Omit<WidgetInput, 'widgetKey'>,
): Promise<DashboardWriteResult<DashboardWidgetRow>> {
  const patch: Partial<typeof dashboardWidgets.$inferInsert> = {};
  if (input.metricKey !== undefined) {
    if (!isMetricKey(String(input.metricKey))) return { ok: false, status: 400, error: 'unknown metric_key' };
    patch.metricKey = String(input.metricKey);
  }
  if (input.viz !== undefined) patch.viz = normaliseViz(input.viz);
  if (typeof input.title === 'string') patch.title = input.title.slice(0, 160);
  if (input.config && typeof input.config === 'object') patch.config = input.config as Record<string, unknown>;
  if (typeof input.position === 'number' && Number.isFinite(input.position)) patch.position = Math.floor(input.position);
  if (Object.keys(patch).length === 0) return { ok: false, status: 400, error: 'nothing to update' };
  const [row] = await db
    .update(dashboardWidgets)
    .set(patch)
    .where(and(eq(dashboardWidgets.id, widgetId), eq(dashboardWidgets.dashboardId, dashboardId), eq(dashboardWidgets.tenantId, tenantId)))
    .returning();
  return row ? { ok: true, row } : { ok: false, status: 404, error: 'not found' };
}

/** Remove a widget. Returns the deleted id, or null when not found. */
export async function removeDashboardWidget(db: Db, tenantId: number, dashboardId: number, widgetId: number): Promise<number | null> {
  const [row] = await db
    .delete(dashboardWidgets)
    .where(and(eq(dashboardWidgets.id, widgetId), eq(dashboardWidgets.dashboardId, dashboardId), eq(dashboardWidgets.tenantId, tenantId)))
    .returning({ id: dashboardWidgets.id });
  return row?.id ?? null;
}

/** Record an Ask-box question + the metric it matched, for history/audit. Best-effort:
 *  history is non-critical, so a failed insert is reported, never thrown. */
export async function recordDashboardQuery(
  db: Db,
  input: { tenantId: number; question: string; matchedMetric: string | null; createdBy?: string | null },
): Promise<void> {
  try {
    await db.insert(savedQueries).values({
      tenantId: input.tenantId,
      question: input.question,
      matchedMetric: input.matchedMetric,
      createdBy: input.createdBy ?? null,
    });
  } catch (error) {
    reportCaughtError(error, { source: 'application/dashboards/savedDashboards.ts', operation: 'recordDashboardQuery' });
  }
}
