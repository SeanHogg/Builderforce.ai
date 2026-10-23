import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { EMPTY_VALUE } from '@/i18n/format';
import { useInsightFormat } from '../format';
import type { ComparedMetric, DeltaTone } from '@/lib/costMetricsApi';

/**
 * How every cost-efficiency figure is printed — ONE place, so the KPI row, the trend
 * chart, the grouping table and the lever table can never show the same metric two
 * ways. Ratios print as a percentage and their deltas as percentage POINTS (a change
 * in a share is not itself a share); spend carries "≈" because it is the cost stamped
 * at write time from a price table, not an invoice line.
 */

/** i18n key (under `insights.cost.metric`) per compared metric. */
export const METRIC_LABEL_KEY: Record<ComparedMetric, string> = {
  cacheHitRate: 'metric.cacheHitRate',
  outputInputRatio: 'metric.outputInputRatio',
  reasoningShare: 'metric.reasoningShare',
  medianContextTokens: 'metric.medianContextTokens',
  medianTurnsPerCompletedRun: 'metric.medianTurns',
  costPerMergedPrUsd: 'metric.costPerMergedPr',
};

const RATIOS: ReadonlySet<ComparedMetric> = new Set(['cacheHitRate', 'outputInputRatio', 'reasoningShare']);

/** Theme token per delta tone — works in both themes, never a literal. */
export const TONE_COLOR: Record<DeltaTone, string> = {
  better: 'var(--success)',
  worse: 'var(--danger)',
  flat: 'var(--text-secondary)',
};

/** i18n key (under `insights.cost`) naming each tone in words — colour is never the only signal. */
export const TONE_LABEL_KEY: Record<DeltaTone, string> = {
  better: 'tone.better',
  worse: 'tone.worse',
  flat: 'tone.flat',
};

const signed = (n: number, body: string): string => (n > 0 ? `+${body}` : body);

export function useCostMetricFormat() {
  const t = useTranslations('insights.cost');
  const { usd, compactTokens } = useInsightFormat();
  return useMemo(() => {
    const approxUsd = (n: number | null | undefined): string => (n == null ? EMPTY_VALUE : t('approx', { value: usd(n) }));
    const ratioPct = (n: number | null | undefined): string => (n == null ? EMPTY_VALUE : `${(n * 100).toFixed(1)}%`);
    const oneDecimal = (n: number | null | undefined): string => (n == null ? EMPTY_VALUE : n.toFixed(1));

    function value(metric: ComparedMetric, n: number | null | undefined): string {
      if (RATIOS.has(metric)) return ratioPct(n);
      if (metric === 'medianContextTokens') return compactTokens(n);
      if (metric === 'medianTurnsPerCompletedRun') return oneDecimal(n);
      return approxUsd(n);
    }

    function delta(metric: ComparedMetric, d: number | null | undefined): string {
      if (d == null) return EMPTY_VALUE;
      if (RATIOS.has(metric)) return t('points', { value: signed(d, (d * 100).toFixed(1)) });
      if (metric === 'medianContextTokens') return signed(d, compactTokens(d));
      if (metric === 'medianTurnsPerCompletedRun') return signed(d, d.toFixed(1));
      return signed(d, approxUsd(d));
    }

    return { value, delta, approxUsd, ratioPct, label: (m: ComparedMetric) => t(METRIC_LABEL_KEY[m] as never), tone: (tone: DeltaTone) => t(TONE_LABEL_KEY[tone] as never) };
  }, [t, usd, compactTokens]);
}
