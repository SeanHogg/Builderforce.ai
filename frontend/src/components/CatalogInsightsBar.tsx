'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { InsightStat } from '@/components/dashboard/InsightStat';
import { DonutChart } from '@/components/charts/DonutChart';
import { BarChart } from '@/components/charts/BarChart';
import { colorAt } from '@/components/charts/chartColors';

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
  /** Primary engagement metric (installs / uses). */
  primary: number;
  /** Secondary engagement metric (likes / stars). */
  secondary?: number;
}

export interface CatalogInsightsBarProps {
  /** Drives the "total" label. */
  entity: 'skills' | 'personas' | 'prompts';
  items: CatalogInsightsItem[];
  /** Which localized label to use for the primary/secondary metrics. */
  primaryMetric: 'installs' | 'usage';
  secondaryMetric?: 'likes' | 'stars';
  /** Which localized label to use for the breakdown donut. */
  groupKind: 'category' | 'source';
}

const TOP_GROUPS = 6;

export function CatalogInsightsBar({ entity, items, primaryMetric, secondaryMetric, groupKind }: CatalogInsightsBarProps) {
  const t = useTranslations('catalogInsights');

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
      .map((i) => ({ key: i.key, label: i.name, value: i.primary }));

    return { total, sumPrimary, sumSecondary, segments, topBars };
  }, [items, t]);

  // Self-gate: nothing meaningful to show.
  if (model.total === 0) return null;

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 14,
        background: 'var(--bg-elevated, var(--card-bg))', border: '1px solid var(--border-subtle, var(--border))',
        borderRadius: 12, padding: 16, marginBottom: 20,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <InsightStat label={t(`total.${entity}`)} value={model.total.toLocaleString()} />
        <InsightStat label={t(`metric.${primaryMetric}`)} value={model.sumPrimary.toLocaleString()} color={colorAt(1)} />
        {secondaryMetric && <InsightStat label={t(`metric.${secondaryMetric}`)} value={model.sumSecondary.toLocaleString()} color={colorAt(6)} />}
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
        {model.topBars.length > 0 && (
          <div>
            <div style={sectionTitle}>{t(`top.${primaryMetric}`)}</div>
            <BarChart data={model.topBars} maxRows={6} labelWidth={130} ariaLabel={t(`top.${primaryMetric}`)} />
          </div>
        )}
      </div>
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary, var(--muted))', marginBottom: 10,
};
