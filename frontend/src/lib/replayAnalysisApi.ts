/**
 * The Insights client's analysis half (PRD 33 §2.1, §8 S4c): segments, filter
 * options, the overview dashboard, smart events, funnels, flow and the cited AI
 * summaries. Spread into `replayApi` — components call `replayApi.<method>`,
 * never this module, so there is still ONE client. Paths are `REPLAY_PATHS`,
 * shapes the shared DTOs (`replayAnalysisRoutes.ts` produces them).
 */

import {
  REPLAY_PATHS,
  type FilterFieldId,
  type ReplayFilter,
  type ReplayFilterOptionsDto,
  type ReplayFlowDto,
  type ReplayFunnelDto,
  type ReplayFunnelEvalDto,
  type ReplayFunnelInput,
  type ReplayOverviewDto,
  type ReplaySegmentDto,
  type ReplaySegmentInput,
  type ReplaySegmentSummaryDto,
  type ReplaySmartEventDto,
  type ReplaySmartEventInput,
  type ReplaySummaryDto,
} from '@builderforce/interaction-contract';
import { apiRequest } from './apiClient';
import { fill, listOf, shared, withQuery } from './replayHttp';

/** The window and the ONE filter every analysis read takes. */
export interface AnalysisQuery {
  days?: number;
  filter?: ReplayFilter | null;
}

/** HTTP statuses the AI summaries answer that the reader is shown in place, not as a fault. */
export const REPLAY_SUMMARY_LIMIT_STATUS = 429;
export const REPLAY_SUMMARY_UNCITED_STATUS = 503;
const SUMMARY_EXPECTED = [REPLAY_SUMMARY_LIMIT_STATUS, REPLAY_SUMMARY_UNCITED_STATUS];

const json = (body: unknown) => JSON.stringify(body);

export const replayAnalysisApi = {
  // ── Segments (saved filters) ───────────────────────────────────────────────
  async listSegments(siteId: string): Promise<ReplaySegmentDto[]> {
    return listOf(await apiRequest<ReplaySegmentDto[] | { items: ReplaySegmentDto[] }>(withQuery(REPLAY_PATHS.segments, siteId)));
  },

  createSegment(siteId: string, input: ReplaySegmentInput): Promise<ReplaySegmentDto> {
    return apiRequest(withQuery(REPLAY_PATHS.segments, siteId), { method: 'POST', body: json(input) });
  },

  updateSegment(siteId: string, segmentId: string, input: Partial<ReplaySegmentInput>): Promise<ReplaySegmentDto> {
    return apiRequest(withQuery(fill(REPLAY_PATHS.segment, { segmentId }), siteId), { method: 'PATCH', body: json(input) });
  },

  async deleteSegment(siteId: string, segmentId: string): Promise<void> {
    await apiRequest(withQuery(fill(REPLAY_PATHS.segment, { segmentId }), siteId), { method: 'DELETE' });
  },

  /** Distinct values per filter field (every field; `field` narrows to one). */
  filterOptions(siteId: string, query: { days?: number; field?: FilterFieldId | null } = {}): Promise<ReplayFilterOptionsDto[]> {
    const url = withQuery(REPLAY_PATHS.filterOptions, siteId, { days: query.days, field: query.field ?? null });
    return shared(url, async () => listOf(await apiRequest<ReplayFilterOptionsDto[] | { items: ReplayFilterOptionsDto[] }>(url)));
  },

  // ── Overview dashboard ─────────────────────────────────────────────────────
  getOverview(siteId: string, query: AnalysisQuery = {}): Promise<ReplayOverviewDto> {
    const url = withQuery(REPLAY_PATHS.overview, siteId, { days: query.days }, query.filter);
    return shared(url, () => apiRequest<ReplayOverviewDto>(url));
  },

  // ── Smart events ───────────────────────────────────────────────────────────
  async listSmartEvents(siteId: string, query: { days?: number } = {}): Promise<ReplaySmartEventDto[]> {
    const url = withQuery(REPLAY_PATHS.smartEvents, siteId, { days: query.days });
    return listOf(await apiRequest<ReplaySmartEventDto[] | { items: ReplaySmartEventDto[] }>(url));
  },

  createSmartEvent(siteId: string, input: ReplaySmartEventInput): Promise<ReplaySmartEventDto> {
    return apiRequest(withQuery(REPLAY_PATHS.smartEvents, siteId), { method: 'POST', body: json(input) });
  },

  async deleteSmartEvent(siteId: string, eventId: string): Promise<void> {
    await apiRequest(withQuery(fill(REPLAY_PATHS.smartEvent, { eventId }), siteId), { method: 'DELETE' });
  },

  /**
   * How many kept recordings a rule would match (≈). Called while the reader
   * types, so a rule the API rejects (400) is the caller's to show, not a fault.
   */
  previewSmartEvent(siteId: string, input: Omit<ReplaySmartEventInput, 'name'> & { name?: string }, query: { days?: number } = {}): Promise<{ count: number }> {
    return apiRequest(withQuery(REPLAY_PATHS.smartEventPreview, siteId, { days: query.days }), {
      method: 'POST',
      body: json(input),
      expectedErrors: [400],
    });
  },

  // ── Funnels ────────────────────────────────────────────────────────────────
  async listFunnels(siteId: string): Promise<ReplayFunnelDto[]> {
    return listOf(await apiRequest<ReplayFunnelDto[] | { items: ReplayFunnelDto[] }>(withQuery(REPLAY_PATHS.funnels, siteId)));
  },

  getFunnel(siteId: string, funnelId: string): Promise<ReplayFunnelDto> {
    return apiRequest(withQuery(fill(REPLAY_PATHS.funnel, { funnelId }), siteId));
  },

  createFunnel(siteId: string, input: ReplayFunnelInput): Promise<ReplayFunnelDto> {
    return apiRequest(withQuery(REPLAY_PATHS.funnels, siteId), { method: 'POST', body: json(input) });
  },

  /** A whole replacement (PUT): name, window and every step. */
  updateFunnel(siteId: string, funnelId: string, input: ReplayFunnelInput): Promise<ReplayFunnelDto> {
    return apiRequest(withQuery(fill(REPLAY_PATHS.funnel, { funnelId }), siteId), { method: 'PUT', body: json(input) });
  },

  async deleteFunnel(siteId: string, funnelId: string): Promise<void> {
    await apiRequest(withQuery(fill(REPLAY_PATHS.funnel, { funnelId }), siteId), { method: 'DELETE' });
  },

  /** The funnel over kept recordings (always ≈), with who dropped at each step. */
  evaluateFunnel(siteId: string, funnelId: string, query: AnalysisQuery = {}): Promise<ReplayFunnelEvalDto> {
    const url = withQuery(fill(REPLAY_PATHS.funnelEvaluate, { funnelId }), siteId, { days: query.days }, query.filter);
    return shared(url, () => apiRequest<ReplayFunnelEvalDto>(url));
  },

  // ── Flow ───────────────────────────────────────────────────────────────────
  flow(siteId: string, query: AnalysisQuery = {}): Promise<ReplayFlowDto> {
    const url = withQuery(REPLAY_PATHS.flow, siteId, { days: query.days }, query.filter);
    return shared(url, () => apiRequest<ReplayFlowDto>(url));
  },

  // ── AI summaries (429 = the daily limit, 503 = no grounded summary) ─────────
  summarizeRecording(siteId: string, recordingId: string, options: { regenerate?: boolean } = {}): Promise<ReplaySummaryDto> {
    return apiRequest(withQuery(fill(REPLAY_PATHS.recordingSummary, { recordingId }), siteId), {
      method: 'POST',
      body: json({ regenerate: options.regenerate === true }),
      expectedErrors: SUMMARY_EXPECTED,
    });
  },

  summarizeSegment(siteId: string, query: AnalysisQuery = {}): Promise<ReplaySegmentSummaryDto> {
    const body: { days?: number; filter?: ReplayFilter } = {};
    if (query.days != null) body.days = query.days;
    if (query.filter && query.filter.all.length > 0) body.filter = query.filter;
    return apiRequest(withQuery(REPLAY_PATHS.segmentSummary, siteId), {
      method: 'POST',
      body: json(body),
      expectedErrors: SUMMARY_EXPECTED,
    });
  },
};
