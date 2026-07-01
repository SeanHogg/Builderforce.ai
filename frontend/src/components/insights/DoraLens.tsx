'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { insightsApi, type DoraInsights } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { DaysWindowSelect, KpiGrid } from './LensShell';
import { BandedMetricBar, type MetricTier } from '@/components/charts/BandedMetricBar';
import { DonutChart } from '@/components/charts/DonutChart';
import { TrendChart, type TrendSeries } from '@/components/charts/TrendChart';
import { hrs, pct } from './format';

/**
 * LENS #2 — DORA four-keys over deployment_events (+ task lead time), now
 * benchmarked against the published DORA performance tiers. Each key is placed on
 * an Elite / High / Medium / Low band (the "business alignment" read: are we an
 * elite delivery org?) and the change-failure split is shown as a ring. The
 * thresholds are the well-known DORA bands; classification is pure + presentation.
 */

type TierKey = 'elite' | 'high' | 'medium' | 'low';
const TIER_ORDER: TierKey[] = ['elite', 'high', 'medium', 'low'];
const TIER_COLOR: Record<TierKey, string> = {
  elite: '#15803d', high: '#22c55e', medium: '#f59e0b', low: '#ef4444',
};

// ── DORA tier classification (index 0=Elite … 3=Low) ─────────────────────────
/** Deployment frequency, per day — higher is better (daily → Elite, weekly →
 *  High, monthly → Medium, less → Low). */
function tierDeployFreq(perDay: number): number {
  if (perDay >= 1) return 0;
  if (perDay >= 1 / 7) return 1;
  if (perDay >= 1 / 30) return 2;
  return 3;
}
/** Lead time for changes, hours — lower is better (<1d / <1w / <1m / ≥1m). */
function tierLeadTime(h: number): number {
  return h < 24 ? 0 : h < 168 ? 1 : h < 730 ? 2 : 3;
}
/** Change-failure rate, % — lower is better (≤5 / ≤15 / ≤30 / >30). */
function tierCfr(p: number): number {
  return p <= 5 ? 0 : p <= 15 ? 1 : p <= 30 ? 2 : 3;
}
/** Time to restore, hours — lower is better (<1h / <1d / <1w / ≥1w). */
function tierMttr(h: number): number {
  return h < 1 ? 0 : h < 24 ? 1 : h < 168 ? 2 : 3;
}

export function DoraLens() {
  const t = useTranslations('insights');
  const [days, setDays] = useState(30);
  const { data, error } = usePmData<DoraInsights>(() => insightsApi.dora(days), [days]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const tiers: MetricTier[] = TIER_ORDER.map((k) => ({ key: k, label: t(`dora.tier.${k}`), color: TIER_COLOR[k] }));

  // Index per key (null = no signal in window → bar reads as "no data").
  const idxDeploy = data.totalDeployments > 0 ? tierDeployFreq(data.deploymentFrequencyPerDay) : null;
  const idxLead = data.leadTimeHours != null ? tierLeadTime(data.leadTimeHours) : null;
  const idxCfr = data.changeFailureRatePct != null ? tierCfr(data.changeFailureRatePct) : null;
  const idxMttr = data.mttrHours != null ? tierMttr(data.mttrHours) : null;

  // Overall tier = mean of the keys we have signal for (rounded) — a balanced read
  // rather than worst-of (which a single sparse key would dominate).
  const present = [idxDeploy, idxLead, idxCfr, idxMttr].filter((x): x is number => x != null);
  const overall = present.length ? TIER_ORDER[Math.round(present.reduce((s, x) => s + x, 0) / present.length)] : null;

  const cfr = data.changeFailureRatePct;

  // Four keys over time — each week's key mapped to a shared 0..3 performance
  // score (3 = Elite … 0 = Low) so the four differently-scaled keys are
  // comparable on one axis. Null keys (no signal that week) plot as 0.
  const series = data.series ?? [];
  const score = (idx: number | null) => (idx == null ? 0 : 3 - idx);
  const trendLabels = series.map((p) => p.bucketStart.slice(5)); // MM-DD
  const trendSeries: TrendSeries[] = [
    { key: 'deploy', label: t('dora.deployFreq'), color: TIER_COLOR.elite, values: series.map((p) => score(p.totalDeployments > 0 ? tierDeployFreq(p.deploymentFrequencyPerDay) : null)) },
    { key: 'lead', label: t('dora.leadTime'), color: '#2563eb', values: series.map((p) => score(p.leadTimeHours != null ? tierLeadTime(p.leadTimeHours) : null)) },
    { key: 'cfr', label: t('dora.cfr'), color: TIER_COLOR.medium, values: series.map((p) => score(p.changeFailureRatePct != null ? tierCfr(p.changeFailureRatePct) : null)) },
    { key: 'mttr', label: t('dora.mttr'), color: TIER_COLOR.low, values: series.map((p) => score(p.mttrHours != null ? tierMttr(p.mttrHours) : null)) },
  ];
  const tierBandLabel = (v: number) => t(`dora.tier.${TIER_ORDER[Math.max(0, Math.min(3, 3 - Math.round(v)))]}`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><DaysWindowSelect value={days} onChange={setDays} /></div>

      <KpiGrid>
        <StatCard label={t('dora.deployFreq')} value={t('dora.perDay', { value: data.deploymentFrequencyPerDay.toFixed(2) })} sub={t('dora.deploys', { n: data.totalDeployments })} />
        <StatCard label={t('dora.leadTime')} value={hrs(data.leadTimeHours)} sub={t('dora.leadSub')} />
        <StatCard label={t('dora.cfr')} value={pct(data.changeFailureRatePct)} sub={t('dora.cfrSub')} />
        <StatCard label={t('dora.mttr')} value={hrs(data.mttrHours)} sub={t('dora.mttrSub')} />
        <StatCard label={t('dora.totalDeploys')} value={String(data.totalDeployments)} sub={t('days', { n: data.windowDays })} />
      </KpiGrid>

      {/* Performance vs. industry — the four keys on their DORA tier bands. */}
      <PmCard
        title={t('dora.performance')}
        action={
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{t('dora.overall')}</span>
            <span
              aria-label={t('dora.tierAria')}
              style={{
                fontSize: '0.76rem', fontWeight: 700, color: '#fff',
                background: overall ? TIER_COLOR[overall] : 'var(--text-muted)',
                padding: '2px 10px', borderRadius: 999,
              }}
            >
              {overall ? t(`dora.tier.${overall}`) : '—'}
            </span>
          </span>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <BandedMetricBar label={t('dora.deployFreq')} valueText={t('dora.perDay', { value: data.deploymentFrequencyPerDay.toFixed(2) })} tiers={tiers} activeIndex={idxDeploy} ariaLabel={t('dora.barAria', { metric: t('dora.deployFreq') })} />
          <BandedMetricBar label={t('dora.leadTime')} valueText={hrs(data.leadTimeHours)} tiers={tiers} activeIndex={idxLead} ariaLabel={t('dora.barAria', { metric: t('dora.leadTime') })} />
          <BandedMetricBar label={t('dora.cfr')} valueText={pct(data.changeFailureRatePct)} tiers={tiers} activeIndex={idxCfr} ariaLabel={t('dora.barAria', { metric: t('dora.cfr') })} />
          <BandedMetricBar label={t('dora.mttr')} valueText={hrs(data.mttrHours)} tiers={tiers} activeIndex={idxMttr} ariaLabel={t('dora.barAria', { metric: t('dora.mttr') })} />
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{t('dora.performanceSub')}</span>
        </div>
      </PmCard>

      {/* Change outcomes — failed vs. successful changes as a ring. */}
      <PmCard title={t('dora.changeOutcomes')}>
        {cfr == null ? (
          <span style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>{t('dora.noCfr')}</span>
        ) : (
          <DonutChart
            ariaLabel={t('dora.ringAria')}
            size={168}
            centerValue={pct(cfr)}
            centerLabel={t('dora.cfr')}
            // Values are already percentages summing to 100 → let the donut's own
            // share column carry the number; suppress the redundant value column.
            formatValue={() => ''}
            segments={[
              { key: 'failed', label: t('dora.failed'), value: cfr, color: '#ef4444' },
              { key: 'ok', label: t('dora.succeeded'), value: Math.max(0, 100 - cfr), color: '#22c55e' },
            ]}
          />
        )}
      </PmCard>

      {/* Four keys over time — weekly performance band per key (self-gating: needs
          at least two buckets to draw a trend). */}
      {trendLabels.length >= 2 && (
        <PmCard title={t('dora.trendTitle')}>
          <TrendChart
            labels={trendLabels}
            series={trendSeries}
            height={210}
            formatValue={tierBandLabel}
            ariaLabel={t('dora.trendTitle')}
          />
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{t('dora.trendSub')}</span>
        </PmCard>
      )}
    </div>
  );
}
