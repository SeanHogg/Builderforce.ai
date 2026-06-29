'use client';

import { useTranslations } from 'next-intl';
import { aiImpactApi, type AiImpactInsights } from '@/lib/aiImpactApi';
import { insightsApi, llmApi, dashboardApi, type EngineeringInsights, type LlmUsageStats, type DashboardUsage } from '@/lib/builderforceApi';
import { recommendationsApi, type RecommendationsResult, type RecSeverity } from '@/lib/recommendationsApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { BarChart } from '@/components/charts/BarChart';
import { KpiGrid } from './LensShell';
import { usd, pct, score2, int, compactTokens } from './format';

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

  // Token spend by model — the raw consumption broken out, ranked. Only the
  // models that actually burned tokens in the window.
  const byModel = data.comparison
    .filter((m) => m.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .map((m) => ({ key: m.model, label: m.model, value: m.tokens }));
  const totalTokens = byModel.reduce((s, m) => s + m.value, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <KpiGrid>
        <StatCard label={t('aiImpact.tokens')} value={compactTokens(totalTokens)} sub={t('aiImpact.tokensSub')} />
        <StatCard label={t('aiImpact.productivityScore')} value={score2(p.score)} sub={deltaSub} />
        <StatCard label={t('aiImpact.throughput')} value={pct(p.throughput * 100)} sub={t('aiImpact.throughputSub')} />
        <StatCard label={t('aiImpact.quality')} value={pct(p.quality * 100)} sub={t('aiImpact.qualitySub')} />
        <StatCard label={t('aiImpact.efficiency')} value={pct(p.efficiency * 100)} sub={t('aiImpact.efficiencySub')} />
      </KpiGrid>

      {byModel.length > 0 && (
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>
            {t('aiImpact.tokensByModel')}
          </div>
          <BarChart
            data={byModel}
            maxRows={6}
            labelWidth={150}
            formatValue={compactTokens}
            ariaLabel={t('aiImpact.tokensByModel')}
          />
        </div>
      )}
    </div>
  );
}

export function LlmUsageSummary(_props: { days: number }) {
  const t = useTranslations('insights');
  // Provider totals are visible to any member; the cost roll-up is a manager
  // surface, so its read is tolerated to fail (the spend KPI shows "—" then).
  const { data: usage, error } = usePmData<LlmUsageStats>(() => llmApi.usage(), []);
  const { data: source } = usePmData<DashboardUsage>(() => dashboardApi.usage('week'), []);

  if (error) return <PmError message={error} />;
  if (!usage) return <PmEmpty message={t('loading')} />;

  return (
    <KpiGrid>
      <StatCard label={t('llm.requests')} value={int(usage.totalRequests)} sub={t('llm.requestsSub')} />
      <StatCard label={t('llm.promptTokens')} value={compactTokens(usage.promptTokens)} sub={t('llm.tokensSub')} />
      <StatCard label={t('llm.completionTokens')} value={compactTokens(usage.completionTokens)} sub={t('llm.tokensSub')} />
      <StatCard label={t('llm.estCost')} value={source ? usd(source.totals.estimatedCostUsd) : '—'} sub={t('llm.estCostSub')} />
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
