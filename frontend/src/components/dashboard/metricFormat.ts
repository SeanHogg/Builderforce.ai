/**
 * Pure metric helpers shared by every Dashboard-library widget — value
 * formatting, trend-delta derivation, and relative-recency labels. Kept
 * hook-free so both server- and client-side widgets can reuse them; the recency
 * formatter takes a next-intl translator so the strings stay localized at the
 * call site (the library ships no hardcoded English).
 */

import {
  classifyTrend,
  type TrendClassification,
  type MetricPolarity,
} from './trend';

/** Format a numeric metric value with its unit suffix (the dashboard convention). */
export function formatMetricValue(value: number | null | undefined, unit = ''): string {
  if (value == null || Number.isNaN(value)) return '—';
  const n = value;
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
  switch (unit) {
    case 'USD':
      return `$${rounded.toLocaleString('en-US')}`;
    case '%':
      return `${rounded}%`;
    case '/day':
      return `${rounded}/day`;
    case 'hours':
      return `${rounded}h`;
    case 'score':
      return `${rounded}`;
    default:
      return rounded.toLocaleString('en-US');
  }
}

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface SeriesDelta {
  /** Signed percentage change of the recent half vs the earlier half. */
  pct: number;
  direction: DeltaDirection;
}

/**
 * Derive a trend delta from a daily series by comparing the recent half of the
 * window against the earlier half (robust to single-day spikes). Returns null
 * when there isn't enough signal to be meaningful.
 */
export function seriesDelta(values: number[]): SeriesDelta | null {
  if (!values || values.length < 4) return null;
  const mid = Math.floor(values.length / 2);
  const earlier = values.slice(0, mid);
  const recent = values.slice(mid);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const e = sum(earlier);
  const r = sum(recent);
  if (e === 0 && r === 0) return null;
  const pct = e === 0 ? 100 : ((r - e) / Math.abs(e)) * 100;
  const rounded = Math.round(pct);
  const direction: DeltaDirection = Math.abs(rounded) < 1 ? 'flat' : rounded > 0 ? 'up' : 'down';
  return { pct: rounded, direction };
}

export type DeltaTone = 'good' | 'bad' | 'neutral';

/**
 * Build an InsightStat delta chip straight from a raw daily series — the one
 * place the "series → {label, direction, tone}" derivation lives so every
 * dashboard tile derives its trend chip identically. Returns null when the
 * series is too short/flat to be meaningful (so the caller omits the chip).
 */
export function buildInsightDelta(
  series: number[],
  goodWhenUp?: boolean | null,
): { label: string; direction: DeltaDirection; tone: DeltaTone } | null {
  const d = seriesDelta(series);
  if (!d) return null;
  return { label: `${Math.abs(d.pct)}%`, direction: d.direction, tone: deltaTone(d.direction, goodWhenUp) };
}

/**
 * Colour a trend delta by the metric's polarity. `goodWhenUp` true → rising is
 * good (merge rate); false → rising is bad (errors, spend); null/undefined →
 * neutral (no inherent direction). A flat trend is always neutral.
 */
export function deltaTone(direction: DeltaDirection, goodWhenUp?: boolean | null): DeltaTone {
  if (direction === 'flat' || goodWhenUp == null) return 'neutral';
  const rising = direction === 'up';
  return rising === goodWhenUp ? 'good' : 'bad';
}

/** Minimal subset of the next-intl translator the recency formatter needs. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Localized "updated Xh ago" label from an ISO string / epoch-ms. Uses the
 * `dashboard.recency.*` namespace via the supplied translator. Returns null for
 * a missing/invalid timestamp so callers can omit the badge entirely.
 */
export function formatRecency(at: string | number | null | undefined, t: Translate, now = Date.now()): string | null {
  if (at == null) return null;
  const ms = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('recency.justNow');
  if (min < 60) return t('recency.minutesAgo', { n: min });
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return t('recency.hoursAgo', { n: hrs });
  const days = Math.floor(hrs / 24);
  return t('recency.daysAgo', { n: days });
}
