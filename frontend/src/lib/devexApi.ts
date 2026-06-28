/**
 * DevEx Surveys & Insights client — /api/devex/*.
 *
 * Wraps apiRequest with typed methods for the survey framework (templates,
 * campaigns, respond) and the insights lens. Mirrors the other thin lib clients.
 */

import { apiRequest } from './apiClient';

// ---------------------------------------------------------------------------
// Shared types (mirror api/src/application/devex/devexSurveys.ts)
// ---------------------------------------------------------------------------

export type DevexQuestionType = 'rating' | 'nps' | 'boolean' | 'text';

export type DevexDimension =
  | 'flow' | 'tooling' | 'ai_tools' | 'deep_work' | 'build_test' | 'docs' | 'sentiment';

export const DEVEX_DIMENSIONS: readonly DevexDimension[] = [
  'flow', 'tooling', 'ai_tools', 'deep_work', 'build_test', 'docs', 'sentiment',
] as const;

export const DEVEX_QUESTION_TYPES: readonly DevexQuestionType[] = ['rating', 'nps', 'boolean', 'text'] as const;

/** Demographic axes results can be broken down by (heatmap / participation). */
export type DevexSegmentKind = 'group' | 'team' | 'location' | 'role';

export const DEVEX_SEGMENT_KINDS: readonly DevexSegmentKind[] = ['group', 'team', 'location', 'role'] as const;

export type DevexSegments = Partial<Record<DevexSegmentKind, string>>;

/** Benchmark percentiles the UI offers. */
export type BenchmarkPercentile = 50 | 75 | 90;

export interface DevexQuestion {
  id: string;
  type: DevexQuestionType;
  prompt: string;
  dimension: DevexDimension;
}

export interface DevexTemplate {
  id: number;
  tenantId: number;
  segmentId: string | null;
  name: string;
  description: string;
  questions: DevexQuestion[];
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DevexCampaign {
  id: number;
  tenantId: number;
  segmentId: string | null;
  templateId: number | null;
  title: string;
  periodMonth: string | null;
  status: 'open' | 'closed';
  anonymous: boolean;
  recipientCount: number | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  /** Present on list responses (campaigns GET joins response counts). */
  responseCount?: number;
}

export type DevexAnswerValue = number | boolean | string;
export type DevexAnswerMap = Record<string, DevexAnswerValue>;

export interface DevexResponse {
  id: number;
  tenantId: number;
  campaignId: number;
  respondentHash: string | null;
  userId: string | null;
  answers: DevexAnswerMap;
  segments: DevexSegments;
  submittedAt: string;
}

export interface DevexDimensionSentiment {
  negative: number;
  neutral: number;
  positive: number;
}

export interface DevexDimensionScore {
  dimension: DevexDimension;
  avgScore: number;
  n: number;
  rank: number;
  trendDelta: number | null;
  benchmarkDelta: number | null;
  questionCount: number;
  commentCount: number;
  sentiment: DevexDimensionSentiment;
}

export interface DevexTrendPoint {
  periodMonth: string;
  avgScore: number;
  enps: number;
  responses: number;
}

export interface DevexDimensionTrendPoint {
  periodMonth: string;
  scores: Partial<Record<DevexDimension, number>>;
  ranks: Partial<Record<DevexDimension, number>>;
}

export interface DevexParticipationPoint {
  date: string;
  responses: number;
  cumulative: number;
}

export interface DevexSegmentCount {
  label: string;
  count: number;
}

export interface DevexSegmentScoreRow {
  label: string;
  n: number;
  overall: number;
  scores: Partial<Record<DevexDimension, number>>;
}

export interface DevexBenchmark {
  percentile: BenchmarkPercentile;
  index: number;
  byDimension: Partial<Record<DevexDimension, number>>;
  companies: number;
  windowDays: number;
}

export interface DevexInsights {
  windowDays: number;
  responseRatePct: number;
  totalResponses: number;
  totalRecipients: number | null;
  avgResponseTimeSec: number | null;
  enps: number;
  index: { score: number; trendDelta: number | null; benchmarkDelta: number | null };
  byDimension: DevexDimensionScore[];
  aiToolsSentiment: { avgScore: number; n: number; positivePct: number };
  trend: DevexTrendPoint[];
  dimensionTrend: DevexDimensionTrendPoint[];
  participation: {
    timeline: DevexParticipationPoint[];
    bySegment: Partial<Record<DevexSegmentKind, DevexSegmentCount[]>>;
  };
  segments: {
    threshold: number;
    byKind: Partial<Record<DevexSegmentKind, DevexSegmentScoreRow[]>>;
  };
  benchmark: DevexBenchmark | null;
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  questions: DevexQuestion[];
  isActive?: boolean;
}

export interface CreateCampaignInput {
  title: string;
  templateId?: number | null;
  periodMonth?: string | null;
  anonymous?: boolean;
  recipientCount?: number | null;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const devexApi = {
  /** The insights lens / "AI DevEx Analysis" rollup. */
  insights: (days = 90, percentile: BenchmarkPercentile = 75): Promise<DevexInsights> =>
    apiRequest<DevexInsights>(`/api/devex/insights?days=${days}&percentile=${percentile}`),

  templates: {
    list: (): Promise<DevexTemplate[]> => apiRequest<DevexTemplate[]>('/api/devex/templates'),
    create: (input: CreateTemplateInput): Promise<DevexTemplate> =>
      apiRequest<DevexTemplate>('/api/devex/templates', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: number, patch: Partial<CreateTemplateInput>): Promise<DevexTemplate> =>
      apiRequest<DevexTemplate>(`/api/devex/templates/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id: number): Promise<{ deleted: number }> =>
      apiRequest<{ deleted: number }>(`/api/devex/templates/${id}`, { method: 'DELETE' }),
  },

  campaigns: {
    list: (): Promise<DevexCampaign[]> => apiRequest<DevexCampaign[]>('/api/devex/campaigns'),
    create: (input: CreateCampaignInput): Promise<DevexCampaign> =>
      apiRequest<DevexCampaign>('/api/devex/campaigns', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: number, patch: Partial<{ title: string; periodMonth: string; status: 'open' | 'closed'; anonymous: boolean; recipientCount: number | null }>): Promise<DevexCampaign> =>
      apiRequest<DevexCampaign>(`/api/devex/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  },

  /** Submit a response to an open campaign (developer+); `segments` tags it for the heatmap. */
  respond: (campaignId: number, answers: DevexAnswerMap, segments?: DevexSegments): Promise<DevexResponse> =>
    apiRequest<DevexResponse>(`/api/devex/campaigns/${campaignId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ answers, segments }),
    }),
};
