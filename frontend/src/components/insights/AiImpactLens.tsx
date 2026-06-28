'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { aiImpactApi, type AiImpactInsights } from '@/lib/aiImpactApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { DonutChart } from '@/components/charts/DonutChart';
import { BarChart } from '@/components/charts/BarChart';
import { TrendChart } from '@/components/charts/TrendChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { colorAt } from '@/components/charts/chartColors';
import { DaysWindowSelect, KpiGrid } from './LensShell';
import { usd, pct, score2, int } from './format';

/**
 * LENS — "AI Impact": adoption & usage trends, a multi-tool evaluation matrix,
 * and a composite AI productivity score, now rendered as a visual dashboard
 * (donut / trend / bar charts via the shared chart primitives) over the same
 * collectors (llm_usage_log + run_model_outcomes). Detail tables sit beneath the
 * charts for the exact numbers.
 */

type UsageMetric = 'activeUsers' | 'runs' | 'tokens' | 'cost';

const segBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 11px',
  borderRadius: 7,
  border: '1px solid var(--border-subtle)',
  background: active ? 'var(--coral-bright)' : 'var(--bg-base)',
  color: active ? '#fff' : 'var(--text-secondary)',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
});

export function AiImpactLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<UsageMetric>('runs');
  const { data, error } = usePmData<AiImpactInsights>(() => aiImpactApi.get(days), [days]);

  const metricOptions: { key: UsageMetric; label: string }[] = useMemo(
    () => [
      { key: 'activeUsers', label: t('aiImpact.activeUsers') },
      { key: 'runs', label: t('aiImpact.runs') },
      { key: 'tokens', label: t('aiImpact.tokens') },
      { key: 'cost', label: t('aiImpact.cost') },
    ],
    [t],
  );

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const p = data.productivity;
  const deltaSub = `${p.deltaPct >= 0 ? '+' : ''}${p.deltaPct.toFixed(0)}% ${t('aiImpact.wow')}`;
  const series = data.adoption.series;

  const usageLabels = series.map((b) => b.bucketStart.slice(5)); // MM-DD
  const usageValues = series.map((b) => (metric === 'cost' ? b.costUsd : b[metric]));
  const runsSpark = series.map((b) => b.runs);
  const fmtMetric = (v: number) => (metric === 'cost' ? usd(v) : int(v));

  const shareSegments = data.adoption.modelShareTrend
    .filter((m) => m.currentSharePct > 0)
    .map((m, i) => ({ key: m.model, label: m.model, value: m.currentSharePct, color: colorAt(i) }));

  const mergeBars = data.comparison.map((r, i) => ({
    key: r.model,
    label: r.model,
    value: r.mergedRatePct,
    color: colorAt(i),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DaysWindowSelect value={days} onChange={setDays} />
      </div>

      {/* AI Productivity Insights — composite score + components */}
      <KpiGrid>
        <StatCard label={t('aiImpact.productivityScore')} value={score2(p.score)} sub={deltaSub} />
        <StatCard
          label={t('aiImpact.throughput')}
          value={pct(p.throughput * 100)}
          sub={t('aiImpact.throughputSub')}
          chart={runsSpark.some((v) => v > 0) ? <Sparkline values={runsSpark} ariaLabel={t('aiImpact.runs')} /> : undefined}
        />
        <StatCard label={t('aiImpact.quality')} value={pct(p.quality * 100)} sub={t('aiImpact.qualitySub')} />
        <StatCard label={t('aiImpact.efficiency')} value={pct(p.efficiency * 100)} sub={t('aiImpact.efficiencySub')} />
        <StatCard label={t('aiImpact.prevScore')} value={score2(p.prevScore)} sub={t('aiImpact.prevSub')} />
      </KpiGrid>

      {/* Usage Over Time — metric-toggle trend chart */}
      <PmCard
        title={t('aiImpact.usageOverTime')}
        action={
          <div style={{ display: 'flex', gap: 6 }}>
            {metricOptions.map((o) => (
              <button key={o.key} type="button" style={segBtn(metric === o.key)} onClick={() => setMetric(o.key)}>
                {o.label}
              </button>
            ))}
          </div>
        }
      >
        {series.length === 0 || usageValues.every((v) => v === 0) ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('aiImpact.noUsage')}</span>
        ) : (
          <TrendChart
            labels={usageLabels}
            series={[{ key: metric, label: metricOptions.find((o) => o.key === metric)!.label, values: usageValues }]}
            area
            formatValue={fmtMetric}
            ariaLabel={t('aiImpact.usageOverTime')}
          />
        )}
      </PmCard>

      {/* Two-up: model share donut + merge-rate bars */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18 }}>
        <PmCard title={t('aiImpact.shareDonutTitle')}>
          {shareSegments.length === 0 ? (
            <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('aiImpact.noUsage')}</span>
          ) : (
            <DonutChart
              segments={shareSegments}
              centerValue={String(shareSegments.length)}
              centerLabel={t('aiImpact.models')}
              formatValue={(v) => `${v.toFixed(0)}%`}
              ariaLabel={t('aiImpact.shareDonutTitle')}
            />
          )}
        </PmCard>

        <PmCard title={t('aiImpact.mergeRateTitle')}>
          {mergeBars.length === 0 ? (
            <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('aiImpact.noRuns')}</span>
          ) : (
            <BarChart data={mergeBars} formatValue={(v) => `${v.toFixed(0)}%`} ariaLabel={t('aiImpact.mergeRateTitle')} />
          )}
        </PmCard>
      </div>

      {/* Multi-Tool Evaluation — head-to-head comparison matrix */}
      <PmCard title={t('aiImpact.comparisonTitle')}>
        {data.comparison.length === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('aiImpact.noRuns')}</span>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('aiImpact.model')}</th>
                  <th style={thStyle}>{t('aiImpact.runs')}</th>
                  <th style={thStyle}>{t('aiImpact.avgScore')}</th>
                  <th style={thStyle}>{t('aiImpact.mergeRate')}</th>
                  <th style={thStyle}>{t('aiImpact.ciGreen')}</th>
                  <th style={thStyle}>{t('aiImpact.avgSteps')}</th>
                  <th style={thStyle}>{t('aiImpact.costPerMergedPr')}</th>
                  <th style={thStyle}>{t('aiImpact.tokens')}</th>
                </tr>
              </thead>
              <tbody>
                {data.comparison.map((r) => (
                  <tr key={r.model} style={trStyle}>
                    <td style={tdStyle}>{r.model}</td>
                    <td style={tdMutedStyle}>{int(r.runs)}</td>
                    <td style={tdMutedStyle}>{score2(r.avgScore)}</td>
                    <td style={tdMutedStyle}>{pct(r.mergedRatePct)}</td>
                    <td style={tdMutedStyle}>{pct(r.ciGreenRatePct)}</td>
                    <td style={tdMutedStyle}>{r.avgSteps.toFixed(1)}</td>
                    <td style={tdMutedStyle}>{usd(r.costPerMergedPrUsd)}</td>
                    <td style={tdMutedStyle}>{int(r.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PmCard>

      {/* Adoption & Usage Trends — model share trend (delta detail) */}
      <PmCard title={t('aiImpact.shareTrendTitle')}>
        {data.adoption.modelShareTrend.length === 0 ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('aiImpact.noUsage')}</span>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('aiImpact.model')}</th>
                  <th style={thStyle}>{t('aiImpact.currentShare')}</th>
                  <th style={thStyle}>{t('aiImpact.shareDelta')}</th>
                </tr>
              </thead>
              <tbody>
                {data.adoption.modelShareTrend.map((r) => (
                  <tr key={r.model} style={trStyle}>
                    <td style={tdStyle}>{r.model}</td>
                    <td style={tdMutedStyle}>{pct(r.currentSharePct)}</td>
                    <td style={tdMutedStyle}>{`${r.deltaPct >= 0 ? '+' : ''}${r.deltaPct.toFixed(0)} pp`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PmCard>
    </div>
  );
}
