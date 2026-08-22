'use client';

/**
 * Forecast / anomaly lens, decomposed into individually-pinnable widgets.
 *
 * The forward-looking overlay (regression projection + z-score anomalies over the
 * existing cost / flow series) is exposed as standalone {@link ComponentDef}s so a
 * user can pin the exact forecast tile they want. Each card reads the SAME
 * collector through the shared, deduped source (one request per metric+window),
 * renders only its body, and drills back into the finance hub's forecast panel.
 *
 * Mirrors financeWidgets.tsx / aiImpactWidgets.tsx exactly.
 */

import { useTranslations } from 'next-intl';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetStat as Stat, WidgetMuted as Muted, useSourceState } from '@/components/widgets/widgetBody';
import type { ComponentSurfaceProps, ComponentDef, ComponentDrill } from '@/lib/components/types';
import { TrendChart, type TrendSeries } from '@/components/charts/TrendChart';
import { forecastApi, type ForecastInsights, type ForecastMetric, type ForecastUnit } from '@/lib/forecastApi';
import { useInsightFormat, type InsightFormatters } from '../format';

const FORECAST_DRILL: ComponentDrill = { kind: 'panel', hub: 'finance', panel: 'forecast' };
// Reuses the finance capability (forecast is the finance-adjacent premium lens).
// A dedicated `insights.forecast` capability can be added later — see integration note.
const FORECAST_CAP = 'insights.finance' as const;

/**
 * A value formatter for the metric's native unit.
 *
 * Takes the lens formatters rather than importing them: `usd` and the grouped
 * fallback are bound to the reader's locale now, and this is module scope, where
 * a hook cannot run.
 */
function unitFormatter(f: InsightFormatters, unit: ForecastUnit): (v: number) => string {
  if (unit === 'usd') return (v) => f.usd(v);
  if (unit === 'pct') return (v) => `${Math.round(v * 10) / 10}%`;
  if (unit === 'hours') return (v) => `${Math.round(v * 10) / 10}h`;
  return (v) => f.int(v);
}

/** One shared, deduped read of the forecast collector per metric+window. */
function useForecast(metric: ForecastMetric, days: number) {
  const source = useSharedSource<ForecastInsights>(`forecast:${metric}:${days}`, () => forecastApi.get(metric, days));
  const t = useTranslations('insights');
  return { data: source.data, state: useSourceState(source), t };
}

// ── Widget bodies ──────────────────────────────────────────────────────────────

function CostProjectionCard({ days }: ComponentSurfaceProps) {
  const insight = useInsightFormat();
  const { data, state, t } = useForecast('cost', days);
  if (!data) return state;
  return <Stat value={unitFormatter(insight, data.unit)(data.projection)} sub={t('forecast.projection')} />;
}

function CycleProjectionCard({ days }: ComponentSurfaceProps) {
  const insight = useInsightFormat();
  const { data, state, t } = useForecast('cycle_time', days);
  if (!data) return state;
  return <Stat value={unitFormatter(insight, data.unit)(data.projection)} sub={t('forecast.metric.cycle_time')} />;
}

function CfrProjectionCard({ days }: ComponentSurfaceProps) {
  const insight = useInsightFormat();
  const { data, state, t } = useForecast('cfr', days);
  if (!data) return state;
  return <Stat value={unitFormatter(insight, data.unit)(data.projection)} sub={t('forecast.metric.cfr')} />;
}

function AnomaliesCard({ days }: ComponentSurfaceProps) {
  const { data, state, t } = useForecast('cost', days);
  if (!data) return state;
  const open = data.anomalies.filter((a) => !a.acknowledged).length;
  return <Stat value={String(open)} sub={t('forecast.anomaliesSub')} />;
}

/** Cost history + dashed projection as a single trend (the headline forecast tile). */
function CostForecastTrendCard({ days }: ComponentSurfaceProps) {
  const insight = useInsightFormat();
  const { data, state, t } = useForecast('cost', days);
  if (!data) return state;
  if (data.history.length === 0) return <Muted>{t('forecast.noData')}</Muted>;

  const labels = [...data.history.map((p) => p.day.slice(5)), ...data.forecast.map((p) => p.day.slice(5))];
  const histLen = data.history.length;
  const fcastLen = data.forecast.length;
  const lastHist = data.history[histLen - 1]?.value ?? 0;
  const series: TrendSeries[] = [
    { key: 'history', label: t('forecast.history'), values: [...data.history.map((p) => p.value), ...Array(fcastLen).fill(0)], color: 'var(--accent)' },
    { key: 'forecast', label: t('forecast.projected'), values: [...Array(Math.max(0, histLen - 1)).fill(0), ...(histLen > 0 ? [lastHist] : []), ...data.forecast.map((p) => p.value)], color: 'var(--text-muted)' },
  ];
  return <TrendChart labels={labels} series={series} formatValue={unitFormatter(insight, data.unit)} ariaLabel={t('forecast.title')} />;
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const FORECAST_COMPONENTS: ComponentDef[] = [
  { id: 'forecast.cost-projection', group: 'forecast', titleKey: 'forecastCostProjection', capability: FORECAST_CAP, size: 'sm', Surface: CostProjectionCard, drill: FORECAST_DRILL },
  { id: 'forecast.cycle-projection', group: 'forecast', titleKey: 'forecastCycleProjection', capability: FORECAST_CAP, size: 'sm', Surface: CycleProjectionCard, drill: FORECAST_DRILL },
  { id: 'forecast.cfr-projection', group: 'forecast', titleKey: 'forecastCfrProjection', capability: FORECAST_CAP, size: 'sm', Surface: CfrProjectionCard, drill: FORECAST_DRILL },
  { id: 'forecast.anomalies', group: 'forecast', titleKey: 'forecastAnomalies', capability: FORECAST_CAP, size: 'sm', Surface: AnomaliesCard, drill: FORECAST_DRILL },
  { id: 'forecast.cost-trend', group: 'forecast', titleKey: 'forecastCostTrend', capability: FORECAST_CAP, size: 'lg', Surface: CostForecastTrendCard, drill: FORECAST_DRILL },
];
