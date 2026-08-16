'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { DonutChart } from '@/components/charts/DonutChart';
import { BarChart } from '@/components/charts/BarChart';
import { TrendChart } from '@/components/charts/TrendChart';
import { colorAt } from '@/components/charts/chartColors';
import { catalogAnalyticsApi, type CatalogAnalytics, type CatalogAnalyticsKind } from '@/lib/builderforceApi';

/**
 * CatalogInsightsBar — the shared, data-driven summary strip for the marketplace
 * catalog surfaces (Skills, Personas, Prompts). Each of those pages was a flat
 * grid of cards with no aggregate read on the corpus; this single reusable strip
 * turns the already-loaded list into the project's "insights everywhere"
 * standard: totals + engagement, a breakdown donut (by category / source) and a
 * ranked top-N bar (by installs / usage). Built once, fed by all three pages, so
 * there's exactly one place that visualises a catalog. Self-gating: renders
 * nothing until there's real signal to show.
 */

export interface CatalogInsightsItem {
  key: string;
  name: string;
  /** Category / source bucket for the breakdown donut (null → "uncategorized"). */
  group: string | null;
  /** Primary engagement metric (installs / uses). Omit for a catalogue that
   *  counts no engagement — an article is read off-platform, so the blog has
   *  nothing to rank its rows by and supplies `bars` instead. */
  primary?: number;
  /** Secondary engagement metric (likes / stars). */
  secondary?: number;
}

/** An explicit ranked bar chart, for a catalogue whose ranking is not per-item. */
export interface CatalogInsightsBars {
  title: string;
  data: { key: string; label: string; value: number }[];
}

export interface CatalogInsightsBarProps {
  /** Drives the "total" label. */
  entity: 'skills' | 'personas' | 'prompts' | 'articles' | 'listings';
  items: CatalogInsightsItem[];
  /** Which localized label to use for the primary/secondary metrics. Omit when
   *  the catalogue carries no engagement numbers — the tiles and the derived
   *  top-N bar are then skipped rather than rendered as a column of zeroes. */
  primaryMetric?: 'installs' | 'usage';
  secondaryMetric?: 'likes' | 'stars';
  /** Which localized label to use for the breakdown donut. */
  groupKind: 'category' | 'source' | 'topic';
  /** When true, fetch + render the server-side adoption TREND (installs/usage
   *  over time) behind a window toggle. Requires an authed tenant session — pass
   *  it only when signed in so the tenant-scoped endpoint isn't hit anonymously. */
  showTrend?: boolean;
  /** Replaces the derived top-N bar. Use when ranking is by something other than
   *  a number on the row (the blog ranks TAGS, not articles). */
  bars?: CatalogInsightsBars;
  /** Stat tiles appended to the totals row, for facts only the page knows. */
  extraStats?: { key: string; label: string; value: string }[];
}

const TOP_GROUPS = 6;
const WINDOWS = [7, 30, 90] as const;

/** The catalogues the analytics endpoint keeps a time series for. */
const ANALYTICS_KINDS = new Set<string>(['skills', 'personas', 'prompts']);

function isAnalyticsKind(entity: string): entity is CatalogAnalyticsKind {
  return ANALYTICS_KINDS.has(entity);
}

export function CatalogInsightsBar({ entity, items, primaryMetric, secondaryMetric, groupKind, showTrend, bars, extraStats }: CatalogInsightsBarProps) {
  const t = useTranslations('catalogInsights');
  const ta = useTranslations('catalogAnalytics');

  const model = useMemo(() => {
    const total = items.length;
    const sumPrimary = items.reduce((s, i) => s + (i.primary || 0), 0);
    const sumSecondary = items.reduce((s, i) => s + (i.secondary || 0), 0);

    // Breakdown by group (count of items per bucket).
    const groupCounts = new Map<string, number>();
    for (const i of items) {
      const g = i.group?.trim() || t('uncategorized');
      groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
    }
    const sortedGroups = [...groupCounts.entries()].sort((a, b) => b[1] - a[1]);
    const head = sortedGroups.slice(0, TOP_GROUPS);
    const tailTotal = sortedGroups.slice(TOP_GROUPS).reduce((s, [, n]) => s + n, 0);
    const segments = head.map(([label, value], idx) => ({ key: label, label, value, color: colorAt(idx) }));
    if (tailTotal > 0) segments.push({ key: '__other', label: t('other'), value: tailTotal, color: colorAt(head.length) });

    // Top items by the primary metric.
    const topBars = [...items]
      .filter((i) => (i.primary || 0) > 0)
      .sort((a, b) => (b.primary || 0) - (a.primary || 0))
      .slice(0, 6)
      .map((i) => ({ key: i.key, label: i.name, value: i.primary ?? 0 }));

    return { total, sumPrimary, sumSecondary, segments, topBars };
  }, [items, t]);

  // Server-fed adoption trend (installs/usage over time), behind a window toggle.
  const [windowDays, setWindowDays] = useState<(typeof WINDOWS)[number]>(30);
  const [trend, setTrend] = useState<CatalogAnalytics | null>(null);
  useEffect(() => {
    // Only three catalogues have a server-side adoption series behind them; the
    // rest are asked for their trend by NOT asking, rather than by firing a
    // request the analytics endpoint has no kind for.
    if (!showTrend || !isAnalyticsKind(entity)) { setTrend(null); return; }
    let alive = true;
    catalogAnalyticsApi.get(entity, windowDays)
      .then((r) => { if (alive) setTrend(r); })
      .catch(() => { if (alive) setTrend(null); });
    return () => { alive = false; };
  }, [showTrend, entity, windowDays]);

  const trendModel = useMemo(() => {
    if (!trend) return null;
    const hasSignal = trend.totals.installs + trend.totals.usage > 0;
    if (!hasSignal) return null;
    const labels = trend.series.map((p) => p.day.slice(5)); // MM-DD
    return {
      labels,
      series: [
        { key: 'installs', label: ta('installs'), values: trend.series.map((p) => p.installs), color: colorAt(1) },
        { key: 'usage', label: ta('usage'), values: trend.series.map((p) => p.usage), color: colorAt(4) },
      ],
    };
  }, [trend, ta]);

  // Self-gate: nothing meaningful to show.
  if (model.total === 0) return null;

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 14,
        background: 'var(--bg-elevated, var(--card-bg))', border: '1px solid var(--border-subtle, var(--border))',
        borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 20,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <InsightStat label={t(`total.${entity}`)} value={model.total.toLocaleString()} />
        {primaryMetric && <InsightStat label={t(`metric.${primaryMetric}`)} value={model.sumPrimary.toLocaleString()} color={colorAt(1)} />}
        {primaryMetric && secondaryMetric && <InsightStat label={t(`metric.${secondaryMetric}`)} value={model.sumSecondary.toLocaleString()} color={colorAt(6)} />}
        {extraStats?.map((stat, idx) => (
          <InsightStat key={stat.key} label={stat.label} value={stat.value} color={colorAt(idx + 2)} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <div>
          <div style={sectionTitle}>{t(`by.${groupKind}`)}</div>
          <DonutChart
            segments={model.segments}
            size={150}
            centerValue={model.total.toLocaleString()}
            centerLabel={t(`total.${entity}`)}
            formatValue={(v) => Math.round(v).toLocaleString()}
            ariaLabel={t(`by.${groupKind}`)}
          />
        </div>
        {/* An explicit `bars` wins over the derived top-N: a catalogue that
            supplies one is ranking by something the rows do not carry. */}
        {bars && bars.data.length > 0 ? (
          <div>
            <div style={sectionTitle}>{bars.title}</div>
            <BarChart data={bars.data} maxRows={6} labelWidth={130} ariaLabel={bars.title} />
          </div>
        ) : primaryMetric && model.topBars.length > 0 ? (
          <div>
            <div style={sectionTitle}>{t(`top.${primaryMetric}`)}</div>
            <BarChart data={model.topBars} maxRows={6} labelWidth={130} ariaLabel={t(`top.${primaryMetric}`)} />
          </div>
        ) : null}
      </div>

      {showTrend && trendModel && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <div style={sectionTitle}>{ta('trendTitle')}</div>
            <div style={{ display: 'flex', gap: 4 }} role="group" aria-label={ta('window')}>
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWindowDays(w)}
                  className={`btn btn-sm ${windowDays === w ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {ta('days', { n: w })}
                </button>
              ))}
            </div>
          </div>
          <TrendChart labels={trendModel.labels} series={trendModel.series} height={180} ariaLabel={ta('trendTitle')} />
        </div>
      )}
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary, var(--muted))', marginBottom: 10,
};
