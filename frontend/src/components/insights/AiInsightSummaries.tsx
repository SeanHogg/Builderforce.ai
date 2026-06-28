'use client';

import { useTranslations } from 'next-intl';
import { aiImpactApi, type AiImpactInsights } from '@/lib/aiImpactApi';
import { insightsApi, type EngineeringInsights } from '@/lib/builderforceApi';
import { recommendationsApi, type RecommendationsResult, type RecSeverity } from '@/lib/recommendationsApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { KpiGrid } from './LensShell';
import { usd, pct, score2 } from './format';

/**
 * Compact "at-a-glance" summaries for the combined AI Insights dashboard.
 *
 * Each summary reads the SAME collector its full lens reads (so the headline
 * numbers always agree) but renders only the KPI row — the full breakdown lives
 * in the drill-down slide-out (the lens itself). Kept tiny and self-contained so
 * the dashboard cards AND the Brain's slide-out can compose them without prop
 * drilling. `days` is owned by the dashboard's shared window selector.
 */

const SEVERITY_COLOR: Record<RecSeverity, string> = {
  critical: '#dc2626',
  warning: '#d97706',
  info: '#2563eb',
};

export function AiImpactSummary({ days }: { days: number }) {
  const t = useTranslations('insights');
  const { data, error } = usePmData<AiImpactInsights>(() => aiImpactApi.get(days), [days]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const p = data.productivity;
  const deltaSub = `${p.deltaPct >= 0 ? '+' : ''}${p.deltaPct.toFixed(0)}% ${t('aiImpact.wow')}`;
  return (
    <KpiGrid>
      <StatCard label={t('aiImpact.productivityScore')} value={score2(p.score)} sub={deltaSub} />
      <StatCard label={t('aiImpact.throughput')} value={pct(p.throughput * 100)} sub={t('aiImpact.throughputSub')} />
      <StatCard label={t('aiImpact.quality')} value={pct(p.quality * 100)} sub={t('aiImpact.qualitySub')} />
      <StatCard label={t('aiImpact.efficiency')} value={pct(p.efficiency * 100)} sub={t('aiImpact.efficiencySub')} />
    </KpiGrid>
  );
}

export function EngineeringSummary({ days }: { days: number }) {
  const t = useTranslations('insights');
  const { data, error } = usePmData<EngineeringInsights>(() => insightsApi.engineering(days), [days]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  return (
    <KpiGrid>
      <StatCard label={t('eng.runs')} value={String(data.totals.runs)} sub={t('days', { n: data.windowDays })} />
      <StatCard label={t('eng.avgScore')} value={score2(data.totals.avgScore)} sub={t('eng.scoreSub')} />
      <StatCard label={t('eng.mergeRate')} value={pct(data.totals.mergedRatePct)} sub={t('eng.mergeSub')} />
      <StatCard label={t('eng.cost')} value={usd(data.totals.costUsd)} sub={t('eng.costSub')} />
    </KpiGrid>
  );
}

export function RecommendationsSummary({ days }: { days: number }) {
  const t = useTranslations('insights');
  const { data, error } = usePmData<RecommendationsResult>(() => recommendationsApi.recommendations(days), [days]);

  if (error) return <PmError message={error} />;
  if (!data) return <PmEmpty message={t('loading')} />;

  const recs = data.recommendations;
  if (recs.length === 0) return <PmEmpty message={t('recs.empty')} />;

  const counts = recs.reduce<Record<RecSeverity, number>>(
    (acc, r) => { acc[r.severity] = (acc[r.severity] ?? 0) + 1; return acc; },
    { critical: 0, warning: 0, info: 0 },
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {(['critical', 'warning', 'info'] as RecSeverity[]).filter((s) => counts[s] > 0).map((s) => (
          <span
            key={s}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 600,
              color: '#fff', background: SEVERITY_COLOR[s], padding: '4px 10px', borderRadius: 999,
            }}
          >
            {counts[s]} {t(`recs.severity.${s}`)}
          </span>
        ))}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {recs.slice(0, 3).map((r) => (
          <li key={r.key} style={{ fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.title}</span> — {r.metric}
          </li>
        ))}
      </ul>
    </div>
  );
}
