/**
 * Cost efficiency sources (cost PRD A4) — kept out of `insightsSources.ts` on purpose:
 * that module is reachable from the app root through the hub summaries, and only the
 * lazily loaded cost lens, cost card and run breakdown need the cost client.
 */
import {
  costMetricsApi, type CostMetricsReport, type CostMetricWindow, type CostMetricGroupBy, type RunCostBreakdown,
} from '@/lib/costMetricsApi';
import { useSharedSource, type SharedAsync } from '@/lib/widgets/sharedSource';

/** Cache, turn, context and cost-per-PR figures for one window and one grouping. */
export function useCostMetrics(window: CostMetricWindow, groupBy: CostMetricGroupBy): SharedAsync<CostMetricsReport> {
  return useSharedSource<CostMetricsReport>(`cost:${window}:${groupBy}`, () => costMetricsApi.metrics(window, groupBy));
}

/** One run's per-turn cost breakdown. Keyed by execution id — a run's turns are immutable once settled. */
export function useRunCostBreakdown(executionId: number): SharedAsync<RunCostBreakdown> {
  return useSharedSource<RunCostBreakdown>(`cost-run:${executionId}`, () => costMetricsApi.run(executionId));
}
