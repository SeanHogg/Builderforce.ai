import { apiRequest } from './apiClient';

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

export interface AiImpactInsights {
  windowDays: number;
  adoption: {
    series: AdoptionBucket[];
    grain: AdoptionGrain;
    modelShareTrend: ModelShareTrend[];
  };
  comparison: ComparisonRow[];
  productivity: ProductivityScore;
}

export const aiImpactApi = {
  get: (days = 30): Promise<AiImpactInsights> =>
    apiRequest<AiImpactInsights>(`/api/insights/ai-impact?days=${days}`),
};
