import { apiRequest } from './apiClient';

/** Internal sentiment / pulse survey client (EMP-15). Aggregate reads never
 *  contain per-user scores (server-enforced anonymity). */

export interface PulseActive {
  survey: { id: string; question: string; scale: number } | null;
  hasResponded: boolean;
}

export interface PulseDistributionBin { score: number; count: number }

export interface PulseAggregate {
  surveyId: string;
  question: string;
  scale: number;
  active: boolean;
  responseCount: number;
  averageScore: number | null;
  enps: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  distribution: PulseDistributionBin[];
  comments: string[];
  commentsSuppressed: boolean;
}

export interface PulseSurveySummary {
  id: string;
  question: string;
  scale: number;
  active: boolean;
  createdAt: string;
  closedAt: string | null;
  responseCount: number;
  averageScore: number | null;
  enps: number | null;
}

export interface PulseTrendPoint {
  surveyId: string;
  question: string;
  createdAt: string;
  averageScore: number | null;
  responseCount: number;
  enps: number | null;
}

export const pulseApi = {
  active: (): Promise<PulseActive> => apiRequest<PulseActive>('/api/pulse/active'),

  respond: (surveyId: string, score: number, comment?: string): Promise<{ ok: boolean }> =>
    apiRequest<{ ok: boolean }>(`/api/pulse/${surveyId}/respond`, {
      method: 'POST', body: JSON.stringify({ score, comment }),
    }),

  list: (): Promise<{ surveys: PulseSurveySummary[] }> =>
    apiRequest<{ surveys: PulseSurveySummary[] }>('/api/pulse'),

  create: (question: string, scale: number): Promise<PulseSurveySummary> =>
    apiRequest<PulseSurveySummary>('/api/pulse', { method: 'POST', body: JSON.stringify({ question, scale }) }),

  close: (id: string): Promise<PulseSurveySummary> =>
    apiRequest<PulseSurveySummary>(`/api/pulse/${id}/close`, { method: 'POST' }),

  aggregate: (id: string): Promise<PulseAggregate> => apiRequest<PulseAggregate>(`/api/pulse/${id}`),

  trend: (): Promise<{ trend: PulseTrendPoint[] }> => apiRequest<{ trend: PulseTrendPoint[] }>('/api/pulse/trend'),
};
