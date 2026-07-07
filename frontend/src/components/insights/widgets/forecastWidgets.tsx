'use client';

/**
 * Forecast / anomaly lens, decomposed into individually-pinnable widgets.
 *
 * The forward-looking overlay (regression projection + z-score anomalies over the
 * existing cost / flow series) is exposed as standalone {@link WidgetDef}s so a
 * user can pin the exact forecast tile they want. Each card reads the SAME
 * collector through the shared, deduped source (one request per metric+window),
 * renders only its body, and drills back into the finance hub's forecast panel.
 *
 * Mirrors financeWidgets.tsx / aiImpactWidgets.tsx exactly.
 */

import { useTranslations } from 'next-intl';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetStat as Stat, WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { TrendChart, type TrendSeries } from '@/components/charts/TrendChart';
import { forecastApi, type ForecastInsights, type ForecastMetric, type ForecastUnit } from '@/lib/forecastApi';
import { usd } from '../format';

const FORECAST_DRILL: WidgetDrill = { kind: 'panel', hub: 'finance', panel: 'forecast' };
// Reuses the finance capability (forecast is the finance-adjacent premium lens).
// A dedicated `insights.forecast` capability can be added later — see integration note.
const FORECAST_CAP = 'insights.finance' as const;

function fmt(unit: ForecastUnit): (v: number) => string {
  if (unit === 'usd') return (v) => usd(v);
  if (unit === 'pct') return (v) => `${Math.round(v * 10) / 10}%`;
  if (unit === 'hours') return (v) => `${Math.round(v * 10) / 10}h`;
  return (v) => Math.round(v).toLocaleString();
}

/** One shared, deduped read of the forecast collector per metric+window. */
function useForecast(metric: ForecastMetric, days: number) {
  const { data, error } = useSharedSource<ForecastInsights>(`forecast:${metric}:${days}`, () => forecastApi.get(metric, days));
  const t = useTranslations('insights');
  const state: React.ReactNode = error ? <Muted>{error}</Muted> : data == null ? <Muted>{t('loading')}</Muted> : null;
  return { data, state, t };
}

// ── Widget bodies ──────────────────────────────────────────────────────────────

function CostProjectionCard({ days }: WidgetCardProps) {
  const { data, state, t } = useForecast('cost', days);
  if (!data) return state;
  return <Stat value={fmt(data.unit)(data.projection)} sub={t('forecast.projection')} />;
}

function CycleProjectionCard({ days }: WidgetCardProps) {
  const { data, state, t } = useForecast('cycle_time', days);
  if (!data) return state;
  return <Stat value={fmt(data.unit)(data.projection)} sub={t('forecast.metric.cycle_time')} />;
}

function CfrProjectionCard({ days }: WidgetCardProps) {
  const { data, state, t } = useForecast('cfr', days);
  if (!data) return state;
  return <Stat value={fmt(data.unit)(data.projection)} sub={t('forecast.metric.cfr')} />;
}

function AnomaliesCard({ days }: WidgetCardProps) {
  const { data, state, t } = useForecast('cost', days);
  if (!data) return state;
  const open = data.anomalies.filter((a) => !a.acknowledged).length;
  return <Stat value={String(open)} sub={t('forecast.anomaliesSub')} />;
}

/** Cost history + dashed projection as a single trend (the headline forecast tile). */
function CostForecastTrendCard({ days }: WidgetCardProps) {
  const { data, state, t } = useForecast('cost', days);
  if (!data) return state;
  if (data.history.length === 0) return <Muted>{t('forecast.noData')}</Muted>;

  const labels = [...data.history.map((p) => p.day.slice(5)), ...data.forecast.map((p) => p.day.slice(5))];
  const histLen = data.history.length;
  const fcastLen = data.forecast.length;
  const lastHist = data.history[histLen - 1]?.value ?? 0;
  const series: TrendSeries[] = [
    { key: 'history', label: t('forecast.history'), values: [...data.history.map((p) => p.value), ...Array(fcastLen).fill(0)], color: 'var(--accent, #2563eb)' },
    { key: 'forecast', label: t('forecast.projected'), values: [...Array(Math.max(0, histLen - 1)).fill(0), ...(histLen > 0 ? [lastHist] : []), ...data.forecast.map((p) => p.value)], color: '#94a3b8' },
  ];
  return <TrendChart labels={labels} series={series} formatValue={fmt(data.unit)} ariaLabel={t('forecast.title')} />;
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const FORECAST_WIDGETS: WidgetDef[] = [
  { id: 'forecast.cost-projection', group: 'forecast', titleKey: 'forecastCostProjection', capability: FORECAST_CAP, size: 'sm', Card: CostProjectionCard, drill: FORECAST_DRILL },
  { id: 'forecast.cycle-projection', group: 'forecast', titleKey: 'forecastCycleProjection', capability: FORECAST_CAP, size: 'sm', Card: CycleProjectionCard, drill: FORECAST_DRILL },
  { id: 'forecast.cfr-projection', group: 'forecast', titleKey: 'forecastCfrProjection', capability: FORECAST_CAP, size: 'sm', Card: CfrProjectionCard, drill: FORECAST_DRILL },
  { id: 'forecast.anomalies', group: 'forecast', titleKey: 'forecastAnomalies', capability: FORECAST_CAP, size: 'sm', Card: AnomaliesCard, drill: FORECAST_DRILL },
  { id: 'forecast.cost-trend', group: 'forecast', titleKey: 'forecastCostTrend', capability: FORECAST_CAP, size: 'lg', Card: CostForecastTrendCard, drill: FORECAST_DRILL },
];
