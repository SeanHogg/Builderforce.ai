import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { PmEmpty, PmError } from '@/components/pm/pmShared';
import { overallOf, type CostGrouping, type CostMetricWindow } from '@/lib/costMetricsApi';
import { useCostMetrics } from './costSources';
import { lensSelectStyle } from '../LensShell';
import { CostKpiRow } from './CostKpiRow';
import { CostTrendChart } from './CostTrendChart';
import { CostGroupBreakdown } from './CostGroupBreakdown';
import { LeverComparisonTable } from './LeverComparisonTable';
import { useCostMetricFormat } from './costMetricFormat';

const WINDOWS: ReadonlyArray<{ id: CostMetricWindow; days: number }> = [
  { id: '7d', days: 7 },
  { id: '30d', days: 30 },
];

/**
 * LENS — "Cost efficiency" (LLM Cost Optimization · A4): is each model dollar buying
 * more shipped work than last month, and which cost lever earned its keep.
 *
 * Container only: it owns the window and grouping state and the four deduped reads
 * (`none` for the headline, `day` for the trend, the chosen grouping, `lever`);
 * every section below is presentational. Opens in the AI hub's slide-out drawer —
 * the drawer applies the capability gate, so this renders only for a reader the
 * server will answer.
 */
export function CostEfficiencyLens() {
  const t = useTranslations('insights');
  const f = useCostMetricFormat();
  const [win, setWin] = useState<CostMetricWindow>('30d');
  const [grouping, setGrouping] = useState<CostGrouping>('actionType');

  const headline = useCostMetrics(win, 'none');
  const daily = useCostMetrics(win, 'day');
  const grouped = useCostMetrics(win, grouping);
  const levers = useCostMetrics(win, 'lever');

  const overall = overallOf(headline.data);
  const windowDays = headline.data?.windowDays ?? WINDOWS.find((w) => w.id === win)?.days ?? 30;

  let verdict: string;
  if (!headline.data) verdict = t('cost.subtitle');
  else if (!overall) verdict = t('cost.empty');
  else if (overall.costPerMergedPrUsd == null) {
    verdict = t('cost.verdictNoPr', { days: windowDays, cache: f.value('cacheHitRate', overall.cacheHitRate) });
  } else {
    verdict = t('cost.verdict', {
      days: windowDays,
      cache: f.value('cacheHitRate', overall.cacheHitRate),
      cost: f.value('costPerMergedPrUsd', overall.costPerMergedPrUsd),
      merged: overall.mergedRuns,
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, flex: '1 1 260px', minWidth: 0, fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)' }}>
          {verdict}
        </p>
        <Select
          style={lensSelectStyle}
          value={win}
          onChange={(e) => setWin(e.target.value as CostMetricWindow)}
          aria-label={t('window')}
        >
          {WINDOWS.map((w) => <option key={w.id} value={w.id}>{t('days', { n: w.days })}</option>)}
        </Select>
      </div>

      {headline.error ? (
        <PmError message={t('cost.loadFailed')} />
      ) : !headline.data ? (
        <PmEmpty message={t('loading')} />
      ) : overall ? (
        <CostKpiRow overall={overall} servedWithoutModel={headline.data.servedWithoutModel} />
      ) : null}

      <CostTrendChart report={daily.data} error={daily.error} />

      <CostGroupBreakdown report={grouped.data} error={grouped.error} grouping={grouping} onGroupingChange={setGrouping} />

      <LeverComparisonTable levers={levers.data ? levers.data.levers ?? [] : null} error={levers.error} />

      <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('cost.basis')}</p>
    </div>
  );
}
