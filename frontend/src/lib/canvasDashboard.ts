/**
 * The Dashboard Object's widget model — the one place that says what a dashboard IS.
 *
 * ── THE DEFECT THIS EXISTS TO REMOVE ─────────────────────────────────────────────
 * A dashboard used to be a FIXED picture with a data hole in it: `DashboardBody`
 * drew exactly one bar list and exactly one donut, both fed from a single
 * `chartLabels`/`chartValues` pair, above a KPI row that fell back to three
 * invented numbers ("Reach 212K", "CTR 3.6%", "Conversion 2.1%"). There was no way
 * to add a second chart, remove one, reorder them, or say "this one is a funnel" —
 * the layout was source code, not data. An unauthored dashboard therefore showed a
 * confident-looking marketing dashboard that was entirely fictional, which is the
 * same failure `emptyShellProblem` was written to stop one field over.
 *
 * A dashboard is now an ORDERED LIST OF WIDGETS. The chart kind is a value in that
 * list, so adding a chart type is a row in {@link DASHBOARD_CHART_DEFINITIONS} and
 * a branch in ONE renderer — never a new field on the object, and never a new
 * `data.kind` special case in the card.
 *
 * ── THE LEGACY WIRE FORMAT ───────────────────────────────────────────────────────
 * `kpis` / `chartLabels` / `chartValues` are still what the model authors through
 * `canvas_add_object` and what `canvas_query_dataset` materializes, and they are
 * still what every board saved before this module holds. They are therefore an
 * INPUT format, not a second storage format: {@link readDashboardWidgets} folds
 * them into widgets on read, and the editor clears them on its first save, so a
 * dashboard converges on exactly one representation of one fact. Legacy content is
 * never silently dropped — anything not already present as a widget is appended.
 */

/** Category axes stop at eight: past that a card-sized chart is unreadable, and it
 *  is where the board's own series palette starts repeating. */
export const DASHBOARD_MAX_CATEGORIES = 8;

/** Widgets per dashboard. High enough never to be reached in practice, low enough
 *  that a malformed patch cannot render ten thousand cards. */
export const DASHBOARD_MAX_WIDGETS = 24;

export const DASHBOARD_CHART_KINDS = [
  'kpi', 'bar', 'column', 'line', 'area', 'donut', 'stackedBar', 'funnel', 'gauge', 'table',
] as const;

export type DashboardChartKind = (typeof DASHBOARD_CHART_KINDS)[number];

export type DashboardWidgetSpan = 'half' | 'full';

/** One named numeric row. Single-series charts read `series[0]`; multi-series charts
 *  draw one mark per entry, aligned to `labels` by index. */
export interface DashboardSeries {
  id: string;
  name: string;
  values: number[];
}

/**
 * One tile on a dashboard.
 *
 * Every field is REQUIRED and defaulted by {@link normalizeDashboardWidget}, so the
 * editor and the renderer never branch on `undefined` — which of the fields actually
 * mean anything is declared by the widget's {@link DashboardChartDefinition}, not
 * discovered by poking at the object.
 */
export interface DashboardWidget {
  id: string;
  chart: DashboardChartKind;
  title: string;
  span: DashboardWidgetSpan;
  /** The category axis, shared by every series on the widget. */
  labels: string[];
  series: DashboardSeries[];
  /** Metric widgets keep the authored STRING, so "212K" and "3.6%" survive verbatim
   *  instead of being rounded into a number the author never wrote. */
  value: string;
  trend: string;
  unit: string;
  /** Gauge only: what the single value is measured against. */
  target: number | null;
}

/**
 * What a chart kind READS — the capability declaration the editor renders its form
 * from and the card renders its marks from. Open/closed: a new chart kind is a row
 * here plus one case in the renderer, and both the editor and the AI field list
 * pick it up with no further edits.
 */
export interface DashboardChartDefinition {
  chart: DashboardChartKind;
  /** Shown in the type picker. Unicode rather than an icon set, because the board
   *  draws its own furniture (see CreationCanvas.module.css). */
  glyph: string;
  /** Width a freshly added widget claims. */
  span: DashboardWidgetSpan;
  /** Reads `labels` as a category axis. */
  categories: boolean;
  /** How many numeric rows it draws. */
  series: 'none' | 'single' | 'multi';
  /** Reads the authored `value` / `trend` strings instead of a numeric series. */
  metric: boolean;
  /** Reads `target` (always alongside `unit`). */
  target: boolean;
}

export const DASHBOARD_CHART_DEFINITIONS: readonly DashboardChartDefinition[] = [
  { chart: 'kpi', glyph: '▣', span: 'half', categories: false, series: 'none', metric: true, target: false },
  { chart: 'bar', glyph: '▬', span: 'half', categories: true, series: 'single', metric: false, target: false },
  { chart: 'column', glyph: '▮', span: 'half', categories: true, series: 'single', metric: false, target: false },
  { chart: 'line', glyph: '∿', span: 'full', categories: true, series: 'multi', metric: false, target: false },
  { chart: 'area', glyph: '◭', span: 'full', categories: true, series: 'multi', metric: false, target: false },
  { chart: 'donut', glyph: '◕', span: 'half', categories: true, series: 'single', metric: false, target: false },
  { chart: 'stackedBar', glyph: '▦', span: 'full', categories: true, series: 'multi', metric: false, target: false },
  { chart: 'funnel', glyph: '▽', span: 'half', categories: true, series: 'single', metric: false, target: false },
  { chart: 'gauge', glyph: '◑', span: 'half', categories: false, series: 'single', metric: false, target: true },
  { chart: 'table', glyph: '▤', span: 'full', categories: true, series: 'multi', metric: false, target: false },
];

const DEFINITION_BY_CHART = new Map(DASHBOARD_CHART_DEFINITIONS.map((d) => [d.chart, d]));

export function dashboardChartDefinition(chart: DashboardChartKind): DashboardChartDefinition {
  return DEFINITION_BY_CHART.get(chart) ?? DASHBOARD_CHART_DEFINITIONS[0]!;
}

function isDashboardChartKind(value: unknown): value is DashboardChartKind {
  return typeof value === 'string' && DEFINITION_BY_CHART.has(value as DashboardChartKind);
}

/* ── parsing ──────────────────────────────────────────────────────────────────── */

/** Split an author's free-typed list (one per line, or comma separated). */
export function parseLabelList(text: string): string[] {
  return text.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).slice(0, DASHBOARD_MAX_CATEGORIES);
}

/** Same split, read as numbers. A non-numeric cell is 0 rather than NaN so a
 *  half-typed row never blanks the chart the author is looking at.
 *
 *  The comma is a SEPARATOR here, so "1,200" is two values — a thousands separator is
 *  indistinguishable from "1, 200" and typing a list is by far the commoner intent. */
export function parseValueList(text: string): number[] {
  return text.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
    .map((item) => { const n = Number(item.replace(/[\s%]/g, '')); return Number.isFinite(n) ? n : 0; })
    .slice(0, DASHBOARD_MAX_CATEGORIES);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) { const n = Number(value.replace(/[\s,%]/g, '')); return Number.isFinite(n) ? n : null; }
  return null;
}

function numbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => numberOrNull(item) ?? 0).slice(0, DASHBOARD_MAX_CATEGORIES);
}

/** A widget id that is stable for the same content across reloads, so React keys and
 *  the legacy fold do not churn. Only used when the author never had one. */
function fallbackId(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

function normalizeSeries(value: unknown, index: number): DashboardSeries {
  const raw = asRecord(value);
  if (!raw) return { id: fallbackId('series', index), name: '', values: numbers(value) };
  return {
    id: text(raw.id) || fallbackId('series', index),
    name: text(raw.name ?? raw.label),
    values: numbers(raw.values ?? raw.data),
  };
}

function normalizeDashboardWidget(value: unknown, index: number): DashboardWidget | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const chart = isDashboardChartKind(raw.chart) ? raw.chart : isDashboardChartKind(raw.kind) ? raw.kind : 'bar';
  const definition = dashboardChartDefinition(chart);
  // A single flat `values` array is accepted as shorthand for one unnamed series, so
  // a model that authors the obvious shape gets the chart it intended.
  const rawSeries = Array.isArray(raw.series) ? raw.series
    : Array.isArray(raw.values) ? [{ values: raw.values }]
      : [];
  const series = rawSeries.slice(0, 8).map(normalizeSeries).filter((s) => s.values.length > 0 || s.name);
  return {
    id: text(raw.id) || fallbackId('widget', index),
    chart,
    title: text(raw.title ?? raw.label),
    span: raw.span === 'full' || raw.span === 'half' ? raw.span : definition.span,
    labels: Array.isArray(raw.labels) ? raw.labels.map(text).slice(0, DASHBOARD_MAX_CATEGORIES) : [],
    series: definition.series === 'single' ? series.slice(0, 1) : series,
    value: text(raw.value),
    trend: text(raw.trend),
    unit: text(raw.unit),
    target: numberOrNull(raw.target),
  };
}

/* ── the legacy fold ──────────────────────────────────────────────────────────── */

/**
 * The widgets implied by the legacy flat fields.
 *
 * `kpis` becomes one metric tile each; a `chartLabels`/`chartValues` pair becomes the
 * bar + donut pair the card used to hardcode, because that IS what those two fields
 * drew and a migration that silently changed the picture would be a worse bug than
 * the one being fixed.
 */
export function deriveLegacyDashboardWidgets(data: Record<string, unknown>): DashboardWidget[] {
  const widgets: DashboardWidget[] = [];
  const kpis = Array.isArray(data.kpis) ? data.kpis.slice(0, 6) : [];
  kpis.forEach((raw, index) => {
    const item = asRecord(raw);
    const title = item ? text(item.label) : '';
    const value = item ? text(item.value) : text(raw);
    if (!title && !value) return;
    widgets.push({
      id: fallbackId('legacy-kpi', index), chart: 'kpi', title, span: 'half',
      labels: [], series: [], value, trend: item ? text(item.trend) : '', unit: item ? text(item.unit) : '',
      target: null,
    });
  });
  const labels = Array.isArray(data.chartLabels) ? data.chartLabels.map(text).slice(0, DASHBOARD_MAX_CATEGORIES) : [];
  const values = numbers(data.chartValues);
  if (labels.length > 0 && values.length > 0) {
    const series: DashboardSeries[] = [{ id: 'legacy-series', name: text(data.yAxisLabel), values }];
    widgets.push({
      id: 'legacy-chart', chart: 'bar', title: text(data.chartTitle), span: 'half',
      labels, series, value: '', trend: '', unit: '', target: null,
    });
    widgets.push({
      id: 'legacy-mix', chart: 'donut', title: '', span: 'half',
      labels, series, value: '', trend: '', unit: '', target: null,
    });
  }
  return widgets;
}

/** Content identity, so folding legacy fields in cannot duplicate a widget the author
 *  already has — and cannot drop one they do not. */
function dashboardWidgetSignature(widget: DashboardWidget): string {
  return [
    widget.chart, widget.title, widget.value, widget.trend,
    widget.labels.join('\u0001'),
    widget.series.map((s) => `${s.name}\u0002${s.values.join(',')}`).join('\u0003'),
  ].join('\u0000');
}

/**
 * Every widget this object should draw, from whichever representation it holds.
 *
 * Stored `widgets` win — they are what the author arranged. Legacy fields are folded
 * in after them, minus anything already present by content, so a model that patches
 * `chartLabels` onto an edited dashboard still lands a visible chart instead of
 * writing into a field nothing reads.
 */
export function readDashboardWidgets(data: Record<string, unknown>): DashboardWidget[] {
  const stored = Array.isArray(data.widgets)
    ? data.widgets.slice(0, DASHBOARD_MAX_WIDGETS)
      .map(normalizeDashboardWidget)
      .filter((widget): widget is DashboardWidget => widget != null)
    : [];
  const legacy = deriveLegacyDashboardWidgets(data);
  if (stored.length === 0) return legacy;
  const seen = new Set(stored.map(dashboardWidgetSignature));
  return [...stored, ...legacy.filter((widget) => !seen.has(dashboardWidgetSignature(widget)))]
    .slice(0, DASHBOARD_MAX_WIDGETS);
}

/**
 * The patch that persists an edited dashboard.
 *
 * The legacy fields are CLEARED, not mirrored: keeping a copy of the same numbers in
 * two shapes is how the card came to disagree with the inspector in the first place.
 * After the first save a dashboard holds its widgets and nothing else.
 */
export function dashboardWidgetsPatch(widgets: readonly DashboardWidget[]): Record<string, unknown> {
  return {
    widgets: widgets.slice(0, DASHBOARD_MAX_WIDGETS).map((widget) => {
      const definition = dashboardChartDefinition(widget.chart);
      return {
        id: widget.id,
        chart: widget.chart,
        title: widget.title,
        span: widget.span,
        ...(definition.categories ? { labels: widget.labels } : {}),
        ...(definition.series !== 'none' ? { series: widget.series } : {}),
        ...(definition.metric ? { value: widget.value, trend: widget.trend } : {}),
        ...(definition.target ? { target: widget.target, unit: widget.unit } : {}),
      };
    }),
    kpis: undefined,
    chartLabels: undefined,
    chartValues: undefined,
  };
}

/**
 * A new widget, seeded with real editable numbers rather than an empty frame.
 *
 * The caller supplies the localized strings: this module is the model, and the model
 * does not know what language the board is in.
 */
export function createDashboardWidget(
  chart: DashboardChartKind,
  seed: { id: string; title: string; categories: readonly string[]; seriesName: string },
): DashboardWidget {
  const definition = dashboardChartDefinition(chart);
  const categories = seed.categories.slice(0, 4);
  const sample = [64, 48, 32, 21].slice(0, categories.length);
  return {
    id: seed.id,
    chart,
    title: seed.title,
    span: definition.span,
    labels: definition.categories ? [...categories] : [],
    // A single-series chart leaves its series UNNAMED: the widget's own title already
    // says what it is, and a default name would print a redundant sub-caption on every
    // new chart. A multi-series chart needs the name to tell its marks apart.
    series: definition.series === 'none' ? []
      : [{
        id: `${seed.id}-s1`,
        name: definition.series === 'multi' ? seed.seriesName : '',
        values: definition.target ? [68] : sample,
      }],
    value: definition.metric ? '0' : '',
    trend: '',
    unit: '',
    target: definition.target ? 100 : null,
  };
}
