import { apiRequest } from './apiClient';

/**
 * Custom Dashboards + AI-Powered Queries — client mirror of
 * api/src/presentation/routes/dashboardsRoutes.ts (mounted at /api/dashboards).
 *
 * Dashboards are widget layouts over a WHITELISTED metric catalogue (no SQL); the
 * "Ask" box posts a natural-language question that the server maps deterministically
 * to one of those whitelisted metrics. Manager-gated writes (dashboards.manage).
 */

export type WidgetViz = 'stat' | 'bar' | 'line' | 'gauge' | 'widget';

/** One day of a date-windowed metric series (UTC 'YYYY-MM-DD' → value). */
export interface MetricPoint {
  day: string;
  value: number;
}

export interface DashboardWidget {
  id: number;
  dashboardId: number;
  /** Scalar whitelisted metric — null for registry widgets. */
  metricKey: string | null;
  /** Registry widget id (rich client-rendered card) — null for scalar metrics. */
  widgetKey: string | null;
  viz: WidgetViz;
  title: string | null;
  config: Record<string, unknown>;
  position: number;
}

export interface SavedDashboard {
  id: number;
  name: string;
  isDefault: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  widgets: DashboardWidget[];
}

export interface MetricCatalogEntry {
  key: string;
  label: string;
  unit: string;
  description: string;
}

export interface WidgetValue {
  widgetId: number;
  metricKey: string | null;
  /** Set when this is a registry widget — render it from the widget registry. */
  widgetKey?: string | null;
  title: string | null;
  viz: WidgetViz;
  value: number | null;
  unit: string;
  label: string;
  days: number;
  /** Date-windowed daily trend (sparkline/line/bar source); null for point-in-time metrics. */
  series?: MetricPoint[] | null;
  error?: string;
}

export interface DashboardData {
  dashboardId: number;
  widgets: WidgetValue[];
}

export interface QueryAnswer {
  matchedMetric: string;
  label: string;
  value: number | null;
  unit: string;
  days: number;
  explanation: string;
}

export const dashboardsApi = {
  // ── Metric catalogue ───────────────────────────────────────────────────────
  metrics: (): Promise<{ metrics: MetricCatalogEntry[] }> =>
    apiRequest('/api/dashboards/metrics'),

  // ── Dashboards CRUD ──────────────────────────────────────────────────────────
  list: (): Promise<{ dashboards: SavedDashboard[] }> =>
    apiRequest('/api/dashboards/dashboards'),

  create: (name: string, isDefault = false): Promise<SavedDashboard> =>
    apiRequest('/api/dashboards/dashboards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, isDefault }),
    }),

  update: (id: number, patch: { name?: string; isDefault?: boolean }): Promise<SavedDashboard> =>
    apiRequest(`/api/dashboards/dashboards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  remove: (id: number): Promise<{ deleted: number }> =>
    apiRequest(`/api/dashboards/dashboards/${id}`, { method: 'DELETE' }),

  // ── Widget CRUD ──────────────────────────────────────────────────────────────
  addWidget: (
    dashboardId: number,
    widget: { metricKey?: string; widgetKey?: string; viz?: WidgetViz; title?: string; config?: Record<string, unknown>; position?: number },
  ): Promise<DashboardWidget> =>
    apiRequest(`/api/dashboards/dashboards/${dashboardId}/widgets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(widget),
    }),

  updateWidget: (
    dashboardId: number,
    widgetId: number,
    patch: { metricKey?: string; viz?: WidgetViz; title?: string; config?: Record<string, unknown>; position?: number },
  ): Promise<DashboardWidget> =>
    apiRequest(`/api/dashboards/dashboards/${dashboardId}/widgets/${widgetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  removeWidget: (dashboardId: number, widgetId: number): Promise<{ deleted: number }> =>
    apiRequest(`/api/dashboards/dashboards/${dashboardId}/widgets/${widgetId}`, { method: 'DELETE' }),

  // ── Resolved widget values ───────────────────────────────────────────────────
  data: (dashboardId: number): Promise<DashboardData> =>
    apiRequest(`/api/dashboards/dashboards/${dashboardId}/data`),

  // ── AI-Powered Query ─────────────────────────────────────────────────────────
  query: (question: string): Promise<QueryAnswer> =>
    apiRequest('/api/dashboards/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    }),
};
