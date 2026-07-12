/**
 * API client for the AI-driven Recommendations + SPACE metrics lenses
 * (/api/insights/recommendations, /api/insights/space). Kept in its own module
 * (not builderforceApi.ts, a shared file) so the feature is self-contained.
 */

import { apiRequest } from './apiClient';

export type RecSeverity = 'critical' | 'warning' | 'info';
export type RecCategory = 'cost' | 'quality' | 'allocation' | 'delivery';
export type RecLinkKind = 'budget' | 'model' | 'allocation_category' | 'dora' | 'project' | 'initiative';
export type RecActionKind = 'navigate' | 'reassign' | 'update_status' | 'add_due_date' | 'hide';

export interface RecLink {
  kind: RecLinkKind;
  id?: string | number;
  label: string;
  href?: string;
  field?: string;
}

export interface RecAction {
  label: string;
  kind: RecActionKind;
  href?: string;
}

export interface RecDataTrace {
  field: string;
  value: string;
  source: string;
}

export interface Recommendation {
  key: string;
  severity: RecSeverity;
  category: RecCategory;
  title: string;
  detail: string;
  metric: string;
  recommendation: string;
  action?: RecAction;
  links?: RecLink[];
  whyItMatters?: string;
  dataTrace?: RecDataTrace[];
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
  feedback: (recKey: string, actedUp: boolean, actedDown: boolean, reason?: string): Promise<void> =>
    apiRequest<void>(`/api/insights/recommendations/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recKey, actedUp, actedDown, reason }),
    }),
  space: (days = 30): Promise<SpaceMetrics> =>
    apiRequest<SpaceMetrics>(`/api/insights/space?days=${days}`),
};