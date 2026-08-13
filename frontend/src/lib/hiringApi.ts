/**
 * Typed client for the Recruiter surface — `/api/hiring/*` and the public `/api/booking/*`.
 *
 * A component never embeds a query and a canvas tool never hand-builds a fetch: both call
 * this, so the wire shape is stated once and every consumer of the funnel — the canvas
 * `funnel` object, the Recruiter seat, the booking page — is reading the same contract.
 */

import { apiRequest } from './apiClient';

export interface FunnelStage {
  stage: string;
  entered: number;
  exited: number;
  conversion: number;
  medianDays: number | null;
}

export interface FunnelSource {
  source: string;
  entered: number;
  converted: number;
  rate: number;
}

export interface HiringFunnelReport {
  pipelineRef: string | null;
  stages: FunnelStage[];
  sourceBreakdown: FunnelSource[];
  totalEntered: number;
  totalConverted: number;
  overallConversion: number;
  medianCycleDays: number | null;
  bottleneck: string | null;
  dateRange: string;
  fetchedAt: string;
}

export interface OfferedSlot { startISO: string; endISO: string }

export interface SlotOffer {
  /** Returned ONCE. It is not recoverable — only its hash is stored. */
  token: string;
  slots: OfferedSlot[];
  expiresAt: string;
}

/** What the candidate's page shows. Deliberately carries nothing identifying. */
export interface BookingView {
  slots: OfferedSlot[];
  durationMinutes: number;
  timezone: string | null;
  booked: boolean;
  bookedAt: string | null;
  expiresAt: string | null;
}

export const hiringApi = {
  /** Stage conversion, time-in-stage and source-of-hire. Cached server-side. */
  funnel: (opts: { pipelineRef?: string; days?: number } = {}): Promise<HiringFunnelReport> => {
    const query = new URLSearchParams();
    if (opts.pipelineRef) query.set('pipelineRef', opts.pipelineRef);
    if (opts.days) query.set('days', String(opts.days));
    const suffix = query.toString() ? `?${query}` : '';
    return apiRequest<HiringFunnelReport>(`/api/hiring/funnel${suffix}`);
  },

  /**
   * Mint a candidate self-schedule link.
   *
   * Resolves to `{ error }` rather than throwing when the panel is genuinely unavailable
   * in the window: that is a real answer a recruiter needs to act on ("widen the window
   * or trim the panel"), not an exception.
   */
  offerSlots: (
    interviewId: number,
    body: { durationMinutes?: number; candidateTimezone?: string; from?: string; to?: string; count?: number; linkDays?: number } = {},
  ): Promise<SlotOffer | { error: string }> =>
    apiRequest<SlotOffer>(`/api/hiring/interviews/${interviewId}/offer-slots`, {
      method: 'POST', body: JSON.stringify(body),
    }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : 'Could not create the booking link.' })),

  /** Record the lawful basis this candidate record is held under, and its clock. */
  recordConsent: (
    candidateRef: string,
    body: { basis: string; consentAt?: string; retentionBasis?: string; retentionDate?: string },
  ): Promise<{ ok: true }> =>
    apiRequest<{ ok: true }>(`/api/hiring/candidates/${encodeURIComponent(candidateRef)}/consent`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  /** Honour an erasure request. */
  erase: (candidateRef: string): Promise<{ ok: true; erasedAt: string }> =>
    apiRequest<{ ok: true; erasedAt: string }>(`/api/hiring/candidates/${encodeURIComponent(candidateRef)}/erase`, {
      method: 'POST',
    }),

  /** Aggregate EEO counts, with small groups suppressed server-side. */
  diversity: (): Promise<{ minimumGroupSize: number; suppressedGroups: number; counts: Array<{ category: string; response: string; count: number }> }> =>
    apiRequest('/api/hiring/diversity'),
};

/**
 * The PUBLIC half — used by the candidate's booking page.
 *
 * `auth: 'none'` and not merely "the web JWT": the caller is a CANDIDATE, who has no
 * account of any kind, which is the entire point of the flow. Sending a stale token from
 * a recruiter's own browser would be worse than sending none — the route ignores it, and
 * carrying it makes the request look authenticated in a log where it is not. The token in
 * the path is the only credential.
 */
export const bookingApi = {
  read: (token: string): Promise<BookingView> =>
    apiRequest<BookingView>(`/api/booking/${encodeURIComponent(token)}`, { auth: 'none' }),

  book: (token: string, startISO: string): Promise<{ booked: true; scheduledAt: string }> =>
    apiRequest<{ booked: true; scheduledAt: string }>(`/api/booking/${encodeURIComponent(token)}/book`, {
      auth: 'none', method: 'POST', body: JSON.stringify({ startISO }),
    }),
};
