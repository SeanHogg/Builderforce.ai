import { useTranslations } from 'next-intl';
import { PmEmpty, PmError } from '@/components/pm/pmShared';
import { costWindowFor, overallOf } from '@/lib/costMetricsApi';
import { useCostMetrics } from './costSources';
import { CostKpiRow } from './CostKpiRow';

/**
 * The AI hub's "Cost efficiency" card. Reads the SAME deduped `groupBy=none` source
 * the lens's KPI row reads, so the card and the drill-down never disagree. The hub's
 * 90-day option maps to the 30-day window (the widest the endpoint serves).
 */
export function CostEfficiencySummary({ days }: { days: number }) {
  const t = useTranslations('insights');
  const { data, error } = useCostMetrics(costWindowFor(days), 'none');

  if (error) return <PmError message={t('cost.loadFailed')} />;
  if (!data) return <PmEmpty message={t('loading')} />;
  const overall = overallOf(data);
  if (!overall) return <PmEmpty message={t('cost.empty')} />;
  return <CostKpiRow overall={overall} compact />;
}
