import { useTranslations } from 'next-intl';
import { StatCard } from '@/components/pm/pmShared';
import { KpiGrid } from '../LensShell';
import { useInsightFormat } from '../format';
import { useCostMetricFormat } from './costMetricFormat';
import type { CostGroupMetrics, ServedWithoutModel } from '@/lib/costMetricsApi';

/**
 * The cost-efficiency headline figures for one window. `compact` is the hub card
 * (the four a reader acts on first); the lens shows all six, plus "served without a
 * model" when the report carries it (a pre-field server omits the card, never shows 0).
 */
export function CostKpiRow({ overall, servedWithoutModel, compact = false }: {
  overall: CostGroupMetrics;
  servedWithoutModel?: ServedWithoutModel;
  compact?: boolean;
}) {
  const { int } = useInsightFormat();
  const f = useCostMetricFormat();
  const t = useTranslations('insights.cost');

  const cache = (
    <StatCard key="cache" label={f.label('cacheHitRate')} value={f.value('cacheHitRate', overall.cacheHitRate)} sub={t('kpi.cacheHitRateSub')} />
  );
  const turns = (
    <StatCard
      key="turns"
      label={f.label('medianTurnsPerCompletedRun')}
      value={f.value('medianTurnsPerCompletedRun', overall.medianTurnsPerCompletedRun)}
      sub={t('kpi.medianTurnsSub', { runs: int(overall.completedRuns) })}
    />
  );
  const context = (
    <StatCard
      key="context"
      label={f.label('medianContextTokens')}
      value={f.value('medianContextTokens', overall.medianContextTokens)}
      sub={t('kpi.medianContextSub')}
    />
  );
  const perPr = (
    <StatCard
      key="pr"
      label={f.label('costPerMergedPrUsd')}
      value={f.value('costPerMergedPrUsd', overall.costPerMergedPrUsd)}
      sub={overall.mergedRuns > 0
        ? t('kpi.costPerPrSub', { median: f.approxUsd(overall.medianCostPerMergedPrUsd), merged: int(overall.mergedRuns) })
        : t('kpi.costPerPrNone')}
    />
  );

  if (compact) return <KpiGrid>{[cache, turns, context, perPr]}</KpiGrid>;

  return (
    <KpiGrid>
      {cache}
      {turns}
      {context}
      <StatCard label={f.label('outputInputRatio')} value={f.value('outputInputRatio', overall.outputInputRatio)} sub={t('kpi.outputInputSub')} />
      <StatCard
        label={f.label('reasoningShare')}
        value={f.value('reasoningShare', overall.reasoningShare)}
        sub={overall.reasoningShare == null ? t('kpi.reasoningUnreported') : t('kpi.reasoningShareSub')}
      />
      {perPr}
      {servedWithoutModel && (
        <StatCard
          label={t('kpi.servedWithoutModel')}
          value={f.ratioPct(servedWithoutModel.share)}
          sub={t('kpi.servedWithoutModelSub', { requests: int(servedWithoutModel.requests) })}
        />
      )}
    </KpiGrid>
  );
}
