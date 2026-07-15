'use client';

/**
 * AI-Impact lens, decomposed into individually-pinnable widgets.
 *
 * The "AI Impact" report used to be one monolithic lens (AiImpactLens.tsx). Each
 * card it drew — the productivity score, throughput, quality, efficiency, usage
 * trend, model-share donut, merge-rate bars, and the comparison tables — is now a
 * standalone {@link WidgetDef} so a user can pin the exact tile they want onto
 * their dashboard (the pins in the screenshot's card corners). Every card reads
 * the SAME collector through {@link useAiImpact} (one shared, deduped request),
 * renders only its body (the WidgetCard chrome supplies frame + title + pin), and
 * drills back into the full AI-Impact slide-out.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { aiImpactApi, type AiImpactInsights } from '@/lib/aiImpactApi';
import { useSharedSource } from '@/lib/widgets/sharedSource';
import { WidgetStat as Stat, WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import type { WidgetCardProps, WidgetDef, WidgetDrill } from '@/lib/widgets/types';
import { DonutChart } from '@/components/charts/DonutChart';
import { BarChart } from '@/components/charts/BarChart';
import { TrendChart } from '@/components/charts/TrendChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { colorAt } from '@/components/charts/chartColors';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { usd, pct, score2, int } from '../format';
import { ProviderConsumptionBreakdown } from '../AiInsightSummaries';

/** One shared, deduped read of the AI-Impact collector per (window). */
function useAiImpact(days: number) {
  return useSharedSource<AiImpactInsights>(`ai-impact:${days}`, () => aiImpactApi.get(days));
}

const DRILL: WidgetDrill = { kind: 'panel', hub: 'ai', panel: 'ai-impact' };
const CAP = 'insights.aiImpact' as const;

// ── Small presentational bodies (the WidgetCard owns the frame/title/pin) ──────

/** Wrap a card body: handles loading / error so each widget needn't repeat it. */
function useImpact(days: number) {
  const t = useTranslations('insights');
  const { data, error } = useAiImpact(days);
  const state: React.ReactNode = error ? <Muted>{error}</Muted> : data == null ? <Muted>{t('loading')}</Muted> : null;
  return { data, state, t };
}

// ── Widget bodies ──────────────────────────────────────────────────────────────

function ProductivityCard({ days }: WidgetCardProps) {
  const { data, state, t } = useImpact(days);
  if (!data) return state;
  const p = data.productivity;
  const sign = p.deltaPct >= 0 ? '+' : '';
  return <Stat value={score2(p.score)} sub={`${sign}${p.deltaPct.toFixed(0)}% ${t('aiImpact.wow')}`} />;
}

function ThroughputCard({ days }: WidgetCardProps) {
  const { data, state, t } = useImpact(days);
  if (!data) return state;
  const runsSpark = data.adoption.series.map((b) => b.runs);
  return (
    <div>
      <Stat value={pct(data.productivity.throughput * 100)} sub={t('aiImpact.throughputSub')} />
      {runsSpark.some((v) => v > 0) && (
        <div style={{ marginTop: 10 }}>
          <Sparkline values={runsSpark} ariaLabel={t('aiImpact.runs')} />
        </div>
      )}
    </div>
  );
}

function QualityCard({ days }: WidgetCardProps) {
  const { data, state, t } = useImpact(days);
  if (!data) return state;
  return <Stat value={pct(data.productivity.quality * 100)} sub={t('aiImpact.qualitySub')} />;
}

function EfficiencyCard({ days }: WidgetCardProps) {
  const { data, state, t } = useImpact(days);
  if (!data) return state;
  return <Stat value={pct(data.productivity.efficiency * 100)} sub={t('aiImpact.efficiencySub')} />;
}

function PrevScoreCard({ days }: WidgetCardProps) {
  const { data, state, t } = useImpact(days);
  if (!data) return state;
  return <Stat value={score2(data.productivity.prevScore)} sub={t('aiImpact.prevSub')} />;
}

type UsageMetric = 'activeUsers' | 'runs' | 'tokens' | 'cost';
const segBtn = (active: boolean): React.CSSProperties => ({
  padding: '4px 9px', borderRadius: 7, border: '1px solid var(--border-subtle)',
  background: active ? 'var(--coral-bright)' : 'var(--bg-base)', color: active ? '#fff' : 'var(--text-secondary)',
  fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer',
});

function UsageCard({ days }: WidgetCardProps) {
  const { data, state, t } = useImpact(days);
  const [metric, setMetric] = useState<UsageMetric>('runs');
  if (!data) return state;
  const series = data.adoption.series;
  const options: { key: UsageMetric; label: string }[] = [
    { key: 'activeUsers', label: t('aiImpact.activeUsers') },
    { key: 'runs', label: t('aiImpact.runs') },
    { key: 'tokens', label: t('aiImpact.tokens') },
    { key: 'cost', label: t('aiImpact.cost') },
  ];
  const labels = series.map((b) => b.bucketStart.slice(5));
  const values = series.map((b) => (metric === 'cost' ? b.costUsd : b[metric]));
  const fmt = (v: number) => (metric === 'cost' ? usd(v) : int(v));
  return (
    <div>
      {/* stopPropagation so toggling a metric doesn't trigger the card's drill */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        {options.map((o) => (
          <button key={o.key} type="button" style={segBtn(metric === o.key)} onClick={() => setMetric(o.key)}>{o.label}</button>
        ))}
      </div>
      {series.length === 0 || values.every((v) => v === 0) ? (
        <Muted>{t('aiImpact.noUsage')}</Muted>
      ) : (
        <TrendChart
          labels={labels}
          series={[{ key: metric, label: options.find((o) => o.key === metric)!.label, values }]}
          area
          formatValue={fmt}
          ariaLabel={t('aiImpact.usageOverTime')}
        />
      )}
    </div>
  );
}

function ModelShareCard({ days }: WidgetCardProps) {
  const { data, state, t } = useImpact(days);
  if (!data) return state;
  const segments = data.adoption.modelShareTrend
    .filter((m) => m.currentSharePct > 0)
    .map((m, i) => ({ key: m.model, label: m.model, value: m.currentSharePct, color: colorAt(i) }));
  if (segments.length === 0) return <Muted>{t('aiImpact.noUsage')}</Muted>;
  return (
    <DonutChart
      segments={segments}
      centerValue={String(segments.length)}
      centerLabel={t('aiImpact.models')}
      formatValue={(v) => `${v.toFixed(0)}%`}
      ariaLabel={t('aiImpact.shareDonutTitle')}
    />
  );
}

function MergeRateCard({ days }: WidgetCardProps) {
  const { data, state, t } = useImpact(days);
  if (!data) return state;
  const bars = data.comparison.map((r, i) => ({ key: r.model, label: r.model, value: r.mergedRatePct, color: colorAt(i) }));
  if (bars.length === 0) return <Muted>{t('aiImpact.noRuns')}</Muted>;
  return <BarChart data={bars} formatValue={(v) => `${v.toFixed(0)}%`} ariaLabel={t('aiImpact.mergeRateTitle')} />;
}

function ComparisonCard({ days }: WidgetCardProps) {
  const { data, state, t } = useImpact(days);
  if (!data) return state;
  if (data.comparison.length === 0) return <Muted>{t('aiImpact.noRuns')}</Muted>;
  return (
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
  );
}

function ShareTrendCard({ days }: WidgetCardProps) {
  const { data, state, t } = useImpact(days);
  if (!data) return state;
  if (data.adoption.modelShareTrend.length === 0) return <Muted>{t('aiImpact.noUsage')}</Muted>;
  return (
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
  );
}

/** Consumption per connected integration / platform key. Renders the SAME
 *  breakdown the AI-Impact summary card shows — one component, one rule for how
 *  BYO spend is presented. */
function ByIntegrationCard({ days }: WidgetCardProps) {
  const { data, state, t } = useImpact(days);
  if (!data) return state;
  if (data.consumption.providers.length === 0) return <Muted>{t('aiImpact.noUsage')}</Muted>;
  return <ProviderConsumptionBreakdown providers={data.consumption.providers} />;
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const AI_IMPACT_WIDGETS: WidgetDef[] = [
  { id: 'ai-impact.productivity', group: 'aiImpact', titleKey: 'aiProductivity', capability: CAP, size: 'sm', Card: ProductivityCard, drill: DRILL },
  { id: 'ai-impact.throughput', group: 'aiImpact', titleKey: 'aiThroughput', capability: CAP, size: 'sm', Card: ThroughputCard, drill: DRILL },
  { id: 'ai-impact.quality', group: 'aiImpact', titleKey: 'aiQuality', capability: CAP, size: 'sm', Card: QualityCard, drill: DRILL },
  { id: 'ai-impact.efficiency', group: 'aiImpact', titleKey: 'aiEfficiency', capability: CAP, size: 'sm', Card: EfficiencyCard, drill: DRILL },
  { id: 'ai-impact.prev-score', group: 'aiImpact', titleKey: 'aiPrevScore', capability: CAP, size: 'sm', Card: PrevScoreCard, drill: DRILL },
  { id: 'ai-impact.usage', group: 'aiImpact', titleKey: 'aiUsage', capability: CAP, size: 'lg', Card: UsageCard, drill: DRILL },
  { id: 'ai-impact.model-share', group: 'aiImpact', titleKey: 'aiModelShare', capability: CAP, size: 'md', Card: ModelShareCard, drill: DRILL },
  { id: 'ai-impact.merge-rate', group: 'aiImpact', titleKey: 'aiMergeRate', capability: CAP, size: 'md', Card: MergeRateCard, drill: DRILL },
  { id: 'ai-impact.comparison', group: 'aiImpact', titleKey: 'aiComparison', capability: CAP, size: 'lg', Card: ComparisonCard, drill: DRILL },
  { id: 'ai-impact.by-integration', group: 'aiImpact', titleKey: 'aiByIntegration', capability: CAP, size: 'md', Card: ByIntegrationCard, drill: DRILL },
  { id: 'ai-impact.share-trend', group: 'aiImpact', titleKey: 'aiShareTrend', capability: CAP, size: 'md', Card: ShareTrendCard, drill: DRILL },
];
