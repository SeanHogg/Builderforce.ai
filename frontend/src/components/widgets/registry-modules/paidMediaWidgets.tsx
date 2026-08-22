'use client';

/**
 * Paid media as pinnable widgets — the `measure` half of the CMO's surface, on any
 * dashboard rather than only inside the canvas panel.
 *
 * All four read ONE shared, deduped source: `/api/ads/insights` returns the whole daily
 * ledger for the window, and every widget here is a different projection of it. Pinning
 * all four therefore costs ONE request, not four — which is the point of
 * {@link useSharedSource} and the reason none of these fetch for themselves.
 *
 * They read our stored ledger, never the networks, so a pinned tile still answers when
 * a grant has expired and shows the same number every other rollup sees. The
 * `ad-insights` sweep is what makes it current.
 */

import { useTranslations, useLocale } from 'next-intl';
import { adsApi, formatMoney, type AdInsightsRead } from '@/lib/adsApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetMuted as Muted, WidgetStat } from '@/components/widgets/widgetBody';
import type { ComponentSurfaceProps, ComponentDef, ComponentDrill } from '@/lib/components/types';
import { BarChart, type BarDatum } from '@/components/charts/BarChart';
import { TrendChart } from '@/components/charts/TrendChart';
import { colorAt } from '@/components/charts/chartColors';
import { useInsightFormat } from '@/components/insights/format';

/** ONE read of the ledger per window, shared by every widget below. */
function useInsights(days: number) {
  return useSharedSource<AdInsightsRead>(`ads:insights:${days}`, () => {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const until = new Date();
    const since = new Date(until.getTime() - days * 86_400_000);
    return adsApi.insights({ since: day(since), until: day(until) });
  });
}

const DRILL: ComponentDrill = { kind: 'route', href: '/growth' };

/** Total spend for the window, with what it bought underneath it. */
function PaidSpendCard({ days }: ComponentSurfaceProps) {
  const { int } = useInsightFormat();
  const t = useTranslations('components');
  const locale = useLocale();
  const { data, error } = useInsights(days);
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.rows.length === 0) return <Muted>{t('paidMedia.noSpend')}</Muted>;
  const currency = data.rows[0]?.currency ?? 'USD';
  return (
    <WidgetStat
      value={formatMoney(data.totals.spendCents, currency, locale)}
      sub={t('paidMedia.spendSub', {
        clicks: int(data.totals.clicks),
        conversions: int(data.totals.conversions),
      })}
    />
  );
}

/**
 * Cost per result — the number a budget decision actually turns on.
 *
 * Shown as an honest absence when nothing has converted: dividing by zero results
 * would either crash or print an infinity, and "no results yet" is the real answer.
 */
function CostPerResultCard({ days }: ComponentSurfaceProps) {
  const { int } = useInsightFormat();
  const t = useTranslations('components');
  const locale = useLocale();
  const { data, error } = useInsights(days);
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;
  if (data.totals.costPerConversionCents == null) return <Muted>{t('paidMedia.noResults')}</Muted>;
  const currency = data.rows[0]?.currency ?? 'USD';
  return (
    <WidgetStat
      value={formatMoney(data.totals.costPerConversionCents, currency, locale)}
      sub={t('paidMedia.costPerResultSub', { conversions: int(data.totals.conversions) })}
    />
  );
}

/** Where the money went, by network. */
function SpendByNetworkCard({ days }: ComponentSurfaceProps) {
  const t = useTranslations('components');
  const locale = useLocale();
  const { data, error } = useInsights(days);
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;

  const byNetwork = new Map<string, number>();
  for (const row of data.rows) {
    byNetwork.set(row.platform, (byNetwork.get(row.platform) ?? 0) + row.spendCents);
  }
  const currency = data.rows[0]?.currency ?? 'USD';
  const bars: BarDatum[] = [...byNetwork.entries()]
    .filter(([, cents]) => cents > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([network, cents], index) => ({ key: network, label: network, value: cents, color: colorAt(index) }));
  if (bars.length === 0) return <Muted>{t('paidMedia.noSpend')}</Muted>;
  return (
    <BarChart
      data={bars}
      formatValue={(value) => formatMoney(value, currency, locale)}
      ariaLabel={t('title.paidMediaSpendByNetwork')}
    />
  );
}

/** Daily spend over the window — the shape that shows a budget running away. */
function SpendTrendCard({ days }: ComponentSurfaceProps) {
  const t = useTranslations('components');
  const locale = useLocale();
  const { data, error } = useInsights(days);
  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>{t('loading')}</Muted>;

  const byDay = new Map<string, number>();
  for (const row of data.rows) {
    byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.spendCents);
  }
  // `labels` and `values` are parallel arrays by contract, so the days are sorted
  // ONCE and both are derived from that order — zipping them separately is how a
  // chart comes to plot Tuesday's spend on Wednesday.
  const ordered = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (ordered.length === 0) return <Muted>{t('paidMedia.noSpend')}</Muted>;
  const currency = data.rows[0]?.currency ?? 'USD';
  return (
    <TrendChart
      labels={ordered.map(([date]) => date)}
      series={[{ key: 'spend', label: t('title.paidMediaSpendTrend'), values: ordered.map(([, cents]) => cents), color: colorAt(0) }]}
      area
      formatValue={(value) => formatMoney(value, currency, locale)}
      ariaLabel={t('title.paidMediaSpendTrend')}
    />
  );
}

export const PAID_MEDIA_COMPONENTS: ComponentDef[] = [
  { id: 'paid.spend', group: 'paidMedia', titleKey: 'paidMediaSpend', descKey: 'paidMediaSpend', size: 'sm', Surface: PaidSpendCard, drill: DRILL },
  { id: 'paid.cost-per-result', group: 'paidMedia', titleKey: 'paidMediaCostPerResult', descKey: 'paidMediaCostPerResult', size: 'sm', Surface: CostPerResultCard, drill: DRILL },
  { id: 'paid.spend-by-network', group: 'paidMedia', titleKey: 'paidMediaSpendByNetwork', size: 'md', Surface: SpendByNetworkCard, drill: DRILL },
  { id: 'paid.spend-trend', group: 'paidMedia', titleKey: 'paidMediaSpendTrend', size: 'md', Surface: SpendTrendCard, drill: DRILL },
];
