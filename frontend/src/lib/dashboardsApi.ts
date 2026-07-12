/** Distinct types of dashboards, each with their own schema. */
export type DashboardKind = 'catalog' | 'metrics' | 'incident' | 'workload' | 'provision';

/** The internal representation of a single resolved widget value after all filters apply. */
export interface WidgetValue {
    /** Unique resource identifier (for fetch monitoring + collisions). */
    id: string;
    /** Human-readable localized label (the small caption). */
    label: string;
    /** Preferred display title (if different from label). */
    title?: string;
    /** The metric used by this widget; used for metadata + context passthrough. */
    metricKey?: string;
    /** The widget identifier used for branding; supersedes label when both are present. */
    widgetKey?: string;
    /** Pre-formatted value (e.g. "$1,240" / "92%" / "—" ). */
    value: string | null;
    /** The unit of the value ("" / "%" / "score" / etc). */
    unit: string;
    /** Period-over-period delta, cached from the backend for the current date range. */
    delta?: number | null;
    /** Normalized delta direction (up | down | flat). */
    direction?: 'up' | 'down' | 'flat' | null;
    /** A sort key used for resizing charts. */
    resizeKey?: string;
    /** The data series used by the backend for ongoing tracking (line/bar/gauge). */
    series?: PointValue[];
    /** Error indicator (network / parsing). */
    error?: string | null;
    /** Boolean polarity flag (higher-is-better = true, lower-is-better = false). */
    goodWhenUp?: boolean | null;
    /** The widgets’ name (catalog metrics / report cards). */
    viz: 'stat' | 'line' | 'bar' | 'gauge';
    /** Number of days in the data window used for this widget. */
    days?: number;
    /** Optional @see TrendArrow classification when trend is available. */
    trendArrow?: 'improving' | 'stable' | 'declining' | 'insufficient';
    /** Comparison window description: "previous 7 days" / "7d" etc. */
    trendWindow?: string;
    /** Optional trend timestamp hint for UI timing purposes. */
    trendTimestamp?: string;
}

/** Daily series backing charts/trends. */
export interface PointValue {
    /** ISO 8601 date-time (local browser side, server-side offset). */
    day: string;
    /** The metric value computed with the configured aggregation. */
    value: number;
    /** Optional metadata extension (e.g. timestamp of a logged event). */
    meta?: Record<string, unknown>;
}

export const METRIC_UNITS: Record<string, string> = {
    count: '',
    dollars: '',
    percent: '%',
    score: '', // UI shows 0.0–1.0 as 0–100% scale
    'c.o.': '',
    currency: '$',
};

/** Very basic polisher for raw metric values that are already-a-number. */
export function formatMetricValue(raw: number | null, unit: string): string {
    if (raw == null) return '—';
    const unitLabel = METRIC_UNITS[unit.toLowerCase()] ?? '';
    return Intl.NumberFormat('en-US', {
        maximumFractionDigits: unit === '%' ? 0 : 2,
        minimumFractionDigits: unit === '%' ? 0 : 0,
        style: unit === '%' ? 'percent' : 'decimal',
    }).format(raw) + unitLabel;
}