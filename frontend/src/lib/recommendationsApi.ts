/**
 * API client for the AI-driven Recommendations + SPACE metrics lenses
 * (/api/insights/recommendations, /api/insights/space). Kept in its own module
 * (not builderforceApi.ts, a shared file) so the feature is self-contained.
 */

import { apiRequest } from './apiClient';

export type RecSeverity = 'critical' | 'warning' | 'info';
export type RecCategory = 'cost' | 'quality' | 'allocation' | 'delivery';

export interface Recommendation {
  key: string;
  severity: RecSeverity;
  category: RecCategory;
  title: string;
  detail: string;
  metric: string;
  recommendation: string;
  rank: number;
}

export interface RecommendationsResult {
  windowDays: number;
  recommendations: Recommendation[];
}

export interface SpaceDimension {
  score: number | null;
  figures: Record<string, number | null>;
}

export interface SpaceMetrics {
  windowDays: number;
  satisfaction: { score: number | null; n: number };
  performance: SpaceDimension;
  activity: SpaceDimension;
  communication: SpaceDimension;
  efficiency: SpaceDimension;
}

export const recommendationsApi = {
  recommendations: (days = 30): Promise<RecommendationsResult> =>
    apiRequest<RecommendationsResult>(`/api/insights/recommendations?days=${days}`),
  dismiss: (recKey: string): Promise<{ dismissed: string }> =>
    apiRequest<{ dismissed: string }>(`/api/insights/recommendations/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recKey }),
    }),
  space: (days = 30): Promise<SpaceMetrics> =>
    apiRequest<SpaceMetrics>(`/api/insights/space?days=${days}`),
};
