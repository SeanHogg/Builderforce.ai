'use client';

/**
 * THE deduped read layer for every insights collector.
 *
 * A hub page, its drill-down lens, and any widget a user has pinned all read the
 * SAME collectors. Before this module each surface owned a private fetch — the
 * delivery hub alone fired `dora`, `lifecycle` and `bottlenecks` three times over
 * (once for the verdict banner, once for each summary tile, once more for every
 * pinned DORA/Delivery widget), which is the N+1 the perf rules reject and the
 * reason a headline figure could disagree with the card beneath it.
 *
 * Every collector is declared here ONCE, keyed by (source × window × project
 * scope), and served through {@link useSharedSource} — the client mirror of the
 * server's read-through cache (single-flight + short TTL). Consequence: N widgets
 * backed by one collector cost ONE request no matter which surface mounts them,
 * and two surfaces reading the same collector are reading the same bytes.
 *
 * Adding a collector: put it here, not in a component. A hook that fetches inside
 * a lens/summary/widget module is the duplicate this file exists to prevent.
 */

import {
  insightsApi, agileMetricsApi, llmApi, dashboardApi, innovationApi,
  type DoraInsights, type LifecycleInsights, type BottleneckInsights,
  type EngineeringInsights, type VelocityInsights, type FunnelMetrics,
  type LlmUsageStats, type DashboardUsage,
} from '@/lib/builderforceApi';
import { aiImpactApi, type AiImpactInsights, type AiOverview } from '@/lib/aiImpactApi';
import { recommendationsApi, type SpaceMetrics, type RecommendationsResult } from '@/lib/recommendationsApi';
import { benchmarkingApi, type BenchmarkingResult } from '@/lib/benchmarkingApi';
import { autonomyApi, type AutonomySummary, type VerdictComplianceReport } from '@/lib/autonomyApi';
import { useSharedSource, type SharedAsync } from '@/lib/widgets/sharedSource';
import { useProjectScope } from '@/lib/ProjectScopeContext';

/**
 * The project half of a cache key. `null` (the TopBar's "All projects") is a real
 * scope, not a missing one, so it gets its own stable token rather than colliding
 * with project id 0.
 */
function scopeKey(projectId: number | null): string {
  return projectId == null ? 'all' : String(projectId);
}

// ── Delivery collectors (window × project scope) ──────────────────────────────

/** DORA four keys. */
export function useDora(days: number): SharedAsync<DoraInsights> {
  const { currentProjectId } = useProjectScope();
  return useSharedSource<DoraInsights>(
    `dora:${days}:p:${scopeKey(currentProjectId)}`,
    () => insightsApi.dora(days, currentProjectId),
  );
}

/** End-to-end life cycle (cycle time by phase + trend). */
export function useLifecycle(days: number): SharedAsync<LifecycleInsights> {
  const { currentProjectId } = useProjectScope();
  return useSharedSource<LifecycleInsights>(
    `lifecycle:${days}:p:${scopeKey(currentProjectId)}`,
    () => insightsApi.lifecycle(days, currentProjectId),
  );
}

/** Stage bottlenecks, rework and aging WIP. */
export function useBottlenecks(days: number): SharedAsync<BottleneckInsights> {
  const { currentProjectId } = useProjectScope();
  return useSharedSource<BottleneckInsights>(
    `bottlenecks:${days}:p:${scopeKey(currentProjectId)}`,
    () => insightsApi.bottlenecks(days, currentProjectId),
  );
}

/**
 * Derived sprint velocity. The collector is scoped by project alone, but the key
 * carries the window so a widget grid sharing one `days` selector never reads a
 * value the rest of the grid disagrees about.
 */
export function useVelocity(days: number): SharedAsync<VelocityInsights> {
  const { currentProjectId } = useProjectScope();
  return useSharedSource<VelocityInsights>(
    `velocity:${days}:p:${scopeKey(currentProjectId)}`,
    () => agileMetricsApi.derivedVelocity(currentProjectId),
  );
}

/** SPACE — the five productivity dimensions. */
export function useSpace(days: number): SharedAsync<SpaceMetrics> {
  const { currentProjectId } = useProjectScope();
  return useSharedSource<SpaceMetrics>(
    `space:${days}:p:${scopeKey(currentProjectId)}`,
    () => recommendationsApi.space(days, currentProjectId),
  );
}

/** Industry benchmarking percentiles. */
export function useBenchmarking(days: number): SharedAsync<BenchmarkingResult> {
  const { currentProjectId } = useProjectScope();
  return useSharedSource<BenchmarkingResult>(
    `benchmarking:${days}:p:${scopeKey(currentProjectId)}`,
    () => benchmarkingApi.get(days, currentProjectId),
  );
}

/** Innovation funnel (idea → ship). Project-scoped; the window is not an input. */
export function useFunnel(): SharedAsync<FunnelMetrics> {
  const { currentProjectId } = useProjectScope();
  return useSharedSource<FunnelMetrics>(
    `funnel:p:${scopeKey(currentProjectId)}`,
    () => innovationApi.funnel(undefined, currentProjectId),
  );
}

/** Autonomy Health — the lifecycle funnel per ticket origin. */
export function useAutonomy(days: number): SharedAsync<AutonomySummary> {
  const { currentProjectId } = useProjectScope();
  return useSharedSource<AutonomySummary>(
    `autonomy:${days}:p:${scopeKey(currentProjectId)}`,
    () => autonomyApi.get(days, currentProjectId),
  );
}

/**
 * VERDICT COMPLIANCE — of the runs asked for a role verdict, how many recorded one.
 *
 * Tenant-wide by design: the question is "which AGENT is the non-reporter", and an
 * agent reviews across projects, so narrowing by the project scope would split the very
 * signal the ranking exists to find.
 */
export function useVerdictCompliance(days: number): SharedAsync<VerdictComplianceReport> {
  return useSharedSource<VerdictComplianceReport>(
    `verdict-compliance:${days}`,
    () => autonomyApi.verdictCompliance(days),
  );
}

// ── AI collectors (window only — these are tenant-wide) ───────────────────────

/** The AI-Impact collector (productivity, adoption, model comparison). */
export function useAiImpact(days: number): SharedAsync<AiImpactInsights> {
  return useSharedSource<AiImpactInsights>(`ai-impact:${days}`, () => aiImpactApi.get(days));
}

/**
 * The bundled AI hub rollup — AI Impact + Engineering + Recommendations in ONE
 * cached read. The hub's three tiles share this single request; a leg the server
 * degraded to `null` is rendered by that tile as its own empty state.
 */
export function useAiOverview(days: number): SharedAsync<AiOverview> {
  return useSharedSource<AiOverview>(`ai-overview:${days}`, () => aiImpactApi.overview(days));
}

/** AI effectiveness by work type and model. */
export function useEngineering(days: number): SharedAsync<EngineeringInsights> {
  const { currentProjectId } = useProjectScope();
  // The project is part of the shared-source KEY, not just the request: two
  // projects sharing one cached source would serve each other's numbers.
  return useSharedSource<EngineeringInsights>(
    `engineering:${days}:p:${scopeKey(currentProjectId)}`,
    () => insightsApi.engineering(days, currentProjectId),
  );
}

/** Ranked prescriptive actions and anomalies. */
export function useRecommendations(days: number): SharedAsync<RecommendationsResult> {
  return useSharedSource<RecommendationsResult>(
    `recommendations:${days}`,
    () => recommendationsApi.recommendations(days),
  );
}

/** LLM provider usage totals + per-model split. */
export function useLlmUsage(): SharedAsync<LlmUsageStats> {
  return useSharedSource<LlmUsageStats>('llm:usage', () => llmApi.usage());
}

/** Token + estimated-cost usage split by source/project. */
export function useLlmBySource(): SharedAsync<DashboardUsage> {
  return useSharedSource<DashboardUsage>('llm:by-source:week', () => dashboardApi.usage('week'));
}
