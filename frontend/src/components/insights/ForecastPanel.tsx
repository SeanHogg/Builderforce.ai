'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { TrendChart, type TrendSeries } from '@/components/charts/TrendChart';
import { PmCard, PmEmpty } from '@/components/pm/pmShared';
import { KpiGrid } from './LensShell';
import { StatCard } from '@/components/pm/pmShared';
import { UpgradeGate } from './UpgradeGate';
import { usd } from './format';
import { forecastApi, type ForecastInsights, type ForecastMetric, type ForecastUnit } from '@/lib/forecastApi';

/**
 * Forecast & anomaly card — the forward-looking overlay for the insight lenses.
 * Charts a metric's observed history plus a DASHED regression projection
 * (rendered as a second TrendChart series that's null across history and defined
 * across the forecast horizon) with anomaly points called out below. Metric is
 * switchable (cost / cycle time / change-failure / throughput).
 *
 * Plan-gated on the server (advancedInsights): a 402 throws a PlanLimitError which
 * we route to <UpgradeGate> so the card shows an in-place upsell.
 */

const METRICS: ForecastMetric[] = ['cost', 'cycle_time', 'cfr', 'throughput'];

const selectStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem',
};

/** Format a value in the metric's native unit. */
function fmt(unit: ForecastUnit): (v: number) => string {
  if (unit === 'usd') return (v) => usd(v);
  if (unit === 'pct') return (v) => `${Math.round(v * 10) / 10}%`;
  if (unit === 'hours') return (v) => `${Math.round(v * 10) / 10}h`;
  return (v) => Math.round(v).toLocaleString();
}

export function ForecastPanel({ initialMetric = 'cost', initialDays = 90 }: { initialMetric?: ForecastMetric; initialDays?: number }) {
  const t = useTranslations('insights');
  const [metric, setMetric] = useState<ForecastMetric>(initialMetric);
  const [days, setDays] = useState(initialDays);
  const [data, setData] = useState<ForecastInsights | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await forecastApi.get(metric, days));
    } catch (e) {
      setError(e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [metric, days]);

  useEffect(() => { void load(); }, [load]);

  const dismiss = async (day: string) => {
    try { await forecastApi.ack(metric, day); await load(); } catch { /* ignore */ }
  };

  const metricLabel = (m: ForecastMetric) => t(`forecast.metric.${m}`);

  const header = (
    <div style={{ display: 'flex', gap: 8 }}>
      <Select style={selectStyle} value={metric} onChange={(e) => setMetric(e.target.value as ForecastMetric)} aria-label={t('forecast.metricLabel')}>
        {METRICS.map((m) => <option key={m} value={m}>{metricLabel(m)}</option>)}
      </Select>
      <Select style={selectStyle} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t('window')}>
        <option value={30}>{t('days', { n: 30 })}</option>
        <option value={90}>{t('days', { n: 90 })}</option>
        <option value={180}>{t('days', { n: 180 })}</option>
      </Select>
    </div>
  );

  if (error) {
    return (
      <PmCard title={t('forecast.title')} action={header}>
        <UpgradeGate error={error} fallback={<PmEmpty message={String((error as Error)?.message ?? t('forecast.error'))} />} />
      </PmCard>
    );
  }

  if (loading && !data) return <PmCard title={t('forecast.title')} action={header}><PmEmpty message={t('loading')} /></PmCard>;
  if (!data) return <PmCard title={t('forecast.title')} action={header}><PmEmpty message={t('forecast.noData')} /></PmCard>;

  const format = fmt(data.unit);
  const openAnomalies = data.anomalies.filter((a) => !a.acknowledged);

  // Build a shared x axis: history days followed by forecast days. The history
  // series carries values across the history segment (0 in the forecast tail) and
  // the forecast series carries values across the forecast segment — so the dashed
  // projection continues visually from where the observed line ends.
  const labels = [...data.history.map((p) => p.day.slice(5)), ...data.forecast.map((p) => p.day.slice(5))];
  const histLen = data.history.length;
  const fcastLen = data.forecast.length;
  const historyValues = [...data.history.map((p) => p.value), ...Array(fcastLen).fill(0)];
  // Anchor the forecast segment to the last observed point so the two lines meet.
  const lastHist = data.history[histLen - 1]?.value ?? 0;
  const forecastValues = [
    ...Array(Math.max(0, histLen - 1)).fill(0),
    ...(histLen > 0 ? [lastHist] : []),
    ...data.forecast.map((p) => p.value),
  ];

  const series: TrendSeries[] = [
    { key: 'history', label: t('forecast.history'), values: historyValues, color: 'var(--accent, #2563eb)' },
    { key: 'forecast', label: t('forecast.projected'), values: forecastValues, color: '#94a3b8' },
  ];

  const trendLabel = data.slope > 0 ? t('forecast.trendUp') : data.slope < 0 ? t('forecast.trendDown') : t('forecast.trendFlat');

  return (
    <PmCard title={t('forecast.title')} action={header}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <KpiGrid>
          <StatCard label={t('forecast.projection')} value={format(data.projection)} sub={metricLabel(metric)} />
          <StatCard label={t('forecast.trend')} value={trendLabel} sub={t('forecast.rSquared', { r: Math.round(data.r2 * 100) })} />
          <StatCard label={t('forecast.anomalies')} value={String(openAnomalies.length)} sub={t('forecast.anomaliesSub')} />
        </KpiGrid>

        {data.history.length === 0 ? (
          <PmEmpty message={t('forecast.noData')} />
        ) : (
          <TrendChart labels={labels} series={series} height={220} formatValue={format} ariaLabel={t('forecast.chartAria', { metric: metricLabel(metric) })} />
        )}

        {openAnomalies.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('forecast.anomalies')}</div>
            {openAnomalies.map((a) => (
              <div key={a.day} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: '0.82rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6 }}>
                <span style={{ color: a.z >= 0 ? 'var(--danger, #dc2626)' : '#d97706' }}>
                  ● {a.day} · {format(a.value)} · {a.z >= 0 ? '+' : ''}{a.z}σ
                </span>
                <button
                  type="button"
                  onClick={() => dismiss(a.day)}
                  style={{ padding: '3px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.76rem', cursor: 'pointer' }}
                >
                  {t('forecast.dismiss')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </PmCard>
  );
}
