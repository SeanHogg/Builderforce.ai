import { apiRequest } from './apiClient';
import type { EngineeringInsights } from './builderforceApi';
import type { RecommendationsResult } from './recommendationsApi';

/**
 * "AI Impact" lens — client mirror of api/src/application/insights/aiImpactInsights.ts.
 * Adoption & usage trends, multi-tool evaluation matrix, and a composite AI
 * productivity score. Manager-gated server-side (insights.aiImpact).
 */

export type AdoptionGrain = 'day' | 'week';

export interface AdoptionBucket {
  bucketStart: string;
  activeUsers: number;
  runs: number;
  tokens: number;
  costUsd: number;
}

export interface ModelShareTrend {
  model: string;
  deltaPct: number;
  currentSharePct: number;
}

export interface ComparisonRow {
  model: string;
  runs: number;
  avgScore: number;
  mergedRatePct: number;
  ciGreenRatePct: number;
  avgSteps: number;
  costPerMergedPrUsd: number | null;
  tokens: number;
}

export interface ProductivityScore {
  score: number;
  throughput: number;
  quality: number;
  efficiency: number;
  prevScore: number;
  deltaPct: number;
}

/** Stable id the server uses for platform-funded spend (Builderforce's own keys). */
export const PLATFORM_PROVIDER_ID = 'builderforce';

export interface ModelConsumption {
  model: string;
  requests: number;
  tokens: number;
  costUsd: number;
  byo: boolean;
  providers: string[];
}

export interface ProviderConsumption {
  provider: string;
  byo: boolean;
  requests: number;
  tokens: number;
  costUsd: number;
  models: string[];
}

export interface AiImpactInsights {
  windowDays: number;
  adoption: {
    series: AdoptionBucket[];
    grain: AdoptionGrain;
    modelShareTrend: ModelShareTrend[];
  };
  comparison: ComparisonRow[];
  /** Raw ledger consumption — covers every surface and both funding sources.
   *  `comparison` only sees scored cloud runs, so it must NOT be used for
   *  "which models are we using" or token totals. */
  consumption: {
    models: ModelConsumption[];
    providers: ProviderConsumption[];
    totalTokens: number;
    totalRequests: number;
    totalCostUsd: number;
    byoTokens: number;
  };
  productivity: ProductivityScore;
}

/**
 * Bundled rollup of the AI Insights dashboard's three summary cards in ONE
 * cached read (`GET /api/insights/ai-overview`) — one round-trip for the landing
 * page instead of three. Each leg mirrors the individual lens's OWN cached read
 * (and can degrade to `null` server-side if that leg errors), so the bundle and
 * the drill-down endpoints share one computation. The drill-down lenses keep
 * fetching their individual endpoints.
 */
export interface AiOverview {
  windowDays: number;
  aiImpact: AiImpactInsights | null;
  engineering: EngineeringInsights | null;
  recommendations: RecommendationsResult | null;
}

export const aiImpactApi = {
  get: (days = 30): Promise<AiImpactInsights> =>
    apiRequest<AiImpactInsights>(`/api/insights/ai-impact?days=${days}`),
  overview: (days = 30): Promise<AiOverview> =>
    apiRequest<AiOverview>(`/api/insights/ai-overview?days=${days}`),
};
