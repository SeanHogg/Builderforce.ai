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
  /** Trend polarity: true=rising is good, false=rising is bad, null=neutral. */
  goodWhenUp?: boolean | null;
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
  /** Trend polarity: true=rising is good, false=rising is bad, null/undefined=neutral. */
  goodWhenUp?: boolean | null;
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
  /**
   * How the metric was chosen: 'keyword' = the deterministic mapper recognised
   * the question, 'llm' = the gateway refiner picked it from the same whitelist,
   * 'default' = NOTHING recognised the question and this is the fallback metric.
   * The last case must be shown as such — a defaulted answer that looks like a
   * match is the failure this field exists to prevent.
   */
  source: 'keyword' | 'llm' | 'default';
}

/** The closed set of situations a question can resolve to; 'metric' = one number. */
export type AnswerTopic =
  | 'overview' | 'delivery' | 'cost' | 'reliability' | 'people' | 'workforce.health' | 'ai' | 'metric';

/**
 * A COMPOSED answer — the shape `POST /query` returns.
 *
 * It extends {@link QueryAnswer} rather than replacing it: the flat fields are
 * populated from `metrics[0]`, so everything that reads `.value` / `.explanation`
 * / `.matchedMetric` keeps working, and the new fields are additive. A question
 * with no single-number answer ("how are things looking?") now comes back as a
 * small dashboard — a headline assembled from the figures, the readings behind it,
 * and the registry widget ids that draw them.
 */
export interface ComposedAnswer extends QueryAnswer {
  topic: AnswerTopic;
  /** One sentence naming the figures it used. Assembled on the server, never generated. */
  headline: string;
  /** The supporting readings, joined into a paragraph. */
  narrative: string;
  /** Every resolved reading, in the topic's declared order. */
  metrics: QueryAnswer[];
  /** Registry widget ids to render — resolve each through `getWidget()`. */
  widgetIds: string[];
}

/** One member in a workforce-health cohort. */
export interface WorkforceHealthMember {
  memberKind: 'human' | 'cloud_agent' | 'host_agent';
  memberRef: string;
  name: string;
  observedWip: number;
  maxWip: number;
  utilizationPct: number;
  activeInWindow: number;
}

/** The three cohorts behind "who is not working, and who is drowning?". */
export interface WorkforceHealthResult {
  overAllocated: WorkforceHealthMember[];
  underUtilised: WorkforceHealthMember[];
  idle: WorkforceHealthMember[];
  membersWithWork: number;
  totalMembers: number;
  days: number;
}

/** A curated dashboard the server declares; materialising one is idempotent. */
export type DashboardPresetKey = 'executive';

export interface ApplyPresetResult {
  dashboardId: number;
  createdDashboard: boolean;
  addedWidgets: number;
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

  /**
   * Materialise a declared preset (manager-gated). Idempotent on the server, so
   * the caller does not have to guard the button against a second click — a
   * re-apply returns the same `dashboardId` with `addedWidgets: 0`.
   */
  applyPreset: (preset: DashboardPresetKey): Promise<ApplyPresetResult> =>
    apiRequest(`/api/dashboards/dashboards/presets/${preset}`, { method: 'POST' }),

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

  // ── Workforce health (the three cohorts, one read) ───────────────────────────
  workforceHealth: (days = 30): Promise<WorkforceHealthResult> =>
    apiRequest(`/api/dashboards/workforce-health?days=${days}`),

  // ── AI-Powered Query ─────────────────────────────────────────────────────────
  query: (question: string): Promise<ComposedAnswer> =>
    apiRequest('/api/dashboards/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    }),
};
