import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { TrendChart } from '@/components/charts/TrendChart';
import { PmEmpty, PmError } from '@/components/pm/pmShared';
import { useFormat } from '@/i18n/useFormat';
import { COMPARED_METRICS, dailySeries, type ComparedMetric, type CostMetricsReport } from '@/lib/costMetricsApi';
import { lensSelectStyle } from '../LensShell';
import { useCostMetricFormat } from './costMetricFormat';

/**
 * Where efficiency is MOVING: one metric, day by day across the window, from the
 * `groupBy=day` report. Presentational — the lens owns the read. A day with no data for
 * the chosen metric is left off the line (never drawn as 0), so a gap reads as a gap.
 */
export function CostTrendChart({ report, error }: { report: CostMetricsReport | null; error: string | null }) {
  const t = useTranslations('insights.cost');
  const tc = useTranslations('common');
  const f = useCostMetricFormat();
  const fmt = useFormat();
  const [metric, setMetric] = useState<ComparedMetric>('cacheHitRate');

  const { days, values } = dailySeries(report, metric);
  const labels = days.map((d) => fmt.dateWith(`${d}T00:00:00Z`, { month: 'short', day: 'numeric', timeZone: 'UTC' }));

  let body: ReactNode;
  if (error) body = <PmError message={t('loadFailed')} />;
  else if (!report) body = <PmEmpty message={tc('loading')} />;
  else if (values.length === 0) body = <PmEmpty message={t('trend.empty')} />;
  else {
    body = (
      <TrendChart
        labels={labels}
        series={[{ key: metric, label: f.label(metric), values }]}
        formatValue={(v) => f.value(metric, v)}
        area
        height={200}
        ariaLabel={t('trend.chartLabel', { metric: f.label(metric) })}
      />
    );
  }

  return (
    <section aria-labelledby="cost-trend-title" style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h3 id="cost-trend-title" style={{ margin: 0, fontSize: 'var(--font-size-body)', fontWeight: 700 }}>{t('trend.title')}</h3>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('trend.desc')}</p>
        </div>
        <Select
          style={{ ...lensSelectStyle, maxWidth: '100%' }}
          value={metric}
          onChange={(e) => setMetric(e.target.value as ComparedMetric)}
          aria-label={t('trend.metric')}
        >
          {COMPARED_METRICS.map((m) => <option key={m} value={m}>{f.label(m)}</option>)}
        </Select>
      </div>
      {body}
    </section>
  );
}
