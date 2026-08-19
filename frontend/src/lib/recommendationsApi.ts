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
  /**
   * `source` names which signal produced the score: 'survey' = people's own DevEx
   * answers, 'engagement' = the member-engagement stand-in used only when nobody
   * answered. Null exactly when `score` is. `n` counts respondents or scored
   * members to match. Rendered on the card, because a proxy shown as a survey
   * result is the one way this number can mislead.
   */
  satisfaction: {
    score: number | null;
    n: number;
    source: 'survey' | 'engagement' | null;
    enps: number | null;
  };
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
  space: (days = 30, projectId?: number | null): Promise<SpaceMetrics> =>
    apiRequest<SpaceMetrics>(`/api/insights/space?days=${days}${projectId != null ? `&projectId=${projectId}` : ''}`),
};
