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

// ---------------------------------------------------------------------------
// The ATS — /api/ats/*
// ---------------------------------------------------------------------------

/**
 * The WORKING half of the Recruiter's surface, next to the reporting half above.
 *
 * It lives in this module rather than in `builderforceApi.ts` because it is the same
 * domain, the same base-path family and the same reader: a component that shows the
 * funnel above a board would otherwise import two clients for one seat. The split that
 * matters is `/api/hiring` (report, comply) against `/api/ats` (work), and the two
 * objects in this file already state it.
 */

/**
 * The values that need a LABEL in every catalog.
 *
 * The server's `/api/ats/vocabulary` is authoritative for BEHAVIOUR — what a decision
 * does, which stages exist in this tenant — and the UI renders whatever it returns. But
 * three of those lists are closed vocabularies the UI puts a translated word against
 * (`ats.decision.kind.*`, `ats.offer.status.*`, `ats.kits.kind.*`), and those keys are
 * built by interpolation, so `check-i18n-keys.mjs` cannot see them: a value the server
 * gains without a catalog entry renders its own dotted key, in five languages, silently.
 *
 * So the labelled set is stated here and asserted against all five catalogs in
 * `components/hiring/atsLabels.test.ts`. It is NOT a second source of truth for what the
 * server accepts — nothing branches on it — it is the list the translators owe a word for.
 * Stage names are deliberately absent: they are free-form per tenant and are rendered
 * verbatim, which is why the board never translates a column heading.
 */
export const ATS_LABELLED_DECISIONS = ['advance', 'reject', 'hold', 'offer', 'hire'] as const;
export const ATS_LABELLED_OFFER_STATUSES = ['draft', 'approved', 'sent', 'accepted', 'declined', 'expired'] as const;
export const ATS_LABELLED_KIT_STAGE_KINDS = ['screen', 'technical', 'panel', 'take_home', 'reference', 'offer'] as const;

/**
 * The stage vocabulary, DECLARED BY THE SERVER.
 *
 * The UI never hardcodes a stage name. Tenants rename them, and a hardcoded ladder is how
 * a board comes to draw a column nobody uses beside a column that is missing.
 */
export interface AtsVocabulary {
  stages: string[];
  decisions: string[];
  kitStageKinds: string[];
  offerStatuses: string[];
}

export interface AtsPipelineSummary {
  pipelineRef: string;
  title: string | null;
  postingStatus: string | null;
  openCount: number;
  lastActivityAt: string | null;
}

export interface AtsCard {
  entryId: number;
  applicationId: number | null;
  candidateRef: string;
  stage: string;
  position: number;
  enteredAt: string;
  ownerRef: string | null;
  source: string | null;
  headline: string | null;
  yearsExp: number | null;
  skills: string[];
  score: number | null;
  daysInStage: number;
}

export interface AtsBoard {
  pipelineRef: string;
  columns: Array<{ stage: string; cards: AtsCard[] }>;
  totalOpen: number;
  fetchedAt: string;
}

export interface AtsApplication {
  id: number;
  jobPostingId: string | null;
  candidateRef: string;
  source: string;
  status: string;
  score: number | null;
  appliedAt: string;
  rejectedAt: string | null;
  rejectReason: string | null;
  headline: string | null;
  yearsExp: number | null;
  skills: string[];
  coverLetter?: string | null;
}

export interface AtsDecision {
  id: number;
  applicationId: number | null;
  candidateRef: string;
  decision: string;
  deciderRef: string | null;
  rationale: string | null;
  evidence: Record<string, unknown> | null;
  decidedAt: string;
}

export interface AtsOffer {
  id: number;
  applicationId: number | null;
  candidateRef: string;
  title: string;
  baseSalary: string | null;
  currency: string;
  equity: string | null;
  startDate: string | null;
  status: string;
  expiresAt: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  signatureRequestId: number | null;
  terms: Record<string, unknown> | null;
}

/** The employer's own snapshot of the résumé the candidate applied with — a copy taken
 *  at submission, never a live read of the candidate's private document store. */
export interface AtsCandidateResume {
  headline: string | null;
  skills: string[];
  yearsExp: number | null;
  parsed: Record<string, unknown>;
}

export interface AtsCandidateDossier {
  application: AtsApplication;
  resume: AtsCandidateResume | null;
  decisions: AtsDecision[];
  offers: AtsOffer[];
}

export interface AtsScorecardAttribute {
  key: string;
  label: string;
  weight: number;
  scaleMin: number;
  scaleMax: number;
  position: number;
}

export interface AtsKitStage {
  id: number;
  name: string;
  kind: string;
  position: number;
  durationMin: number | null;
  scorecardId: string | null;
  interviewerRefs: string[];
  guidance: string | null;
  scorecard: AtsScorecardAttribute[];
}

export interface AtsKit {
  id: number;
  name: string;
  roleFamily: string | null;
  description: string | null;
  isDefault: boolean;
  createdBy: string | null;
  stages: AtsKitStage[];
}

export interface AtsKitStageInput {
  name: string;
  kind?: string;
  durationMin?: number | null;
  interviewerRefs?: string[];
  guidance?: string | null;
  scorecardId?: string | null;
  scorecard?: Array<{ key: string; label: string; weight?: number; scaleMin?: number; scaleMax?: number }>;
}

export interface AtsMoveResult {
  entryId: number;
  fromStage: string;
  toStage: string;
  position: number;
  /** False for a reorder inside one column — no funnel event was recorded. */
  transitioned: boolean;
  daysInPreviousStage: number | null;
}

export interface AtsSentOffer {
  offer: AtsOffer;
  signature: {
    requestId: number;
    status: string;
    /** The one-time invitation credentials. They exist ONLY in this response. */
    invitations: Array<{ partyId: number; name: string; email: string; token: string }>;
  };
}

const post = <T>(path: string, payload?: unknown): Promise<T> =>
  apiRequest<T>(path, { method: 'POST', ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });

const patch = <T>(path: string, payload: unknown): Promise<T> =>
  apiRequest<T>(path, { method: 'PATCH', body: JSON.stringify(payload) });

export const atsApi = {
  /** The vocabulary the server writes with. Read once per surface. */
  vocabulary: (): Promise<AtsVocabulary> => apiRequest<AtsVocabulary>('/api/ats/vocabulary'),

  pipelines: (): Promise<AtsPipelineSummary[]> =>
    apiRequest<{ pipelines: AtsPipelineSummary[] }>('/api/ats/pipelines').then((r) => r.pipelines),

  board: (pipelineRef: string): Promise<AtsBoard> =>
    apiRequest<AtsBoard>(`/api/ats/pipelines/${encodeURIComponent(pipelineRef)}/board`),

  /** Move a candidate to a stage, or reorder them inside the one they are in. A move
   *  that IS a decision goes through `applications.decide` instead, which records why. */
  move: (pipelineRef: string, body: { candidateRef: string; toStage: string; position?: number; ownerRef?: string }): Promise<AtsMoveResult> =>
    post<AtsMoveResult>(`/api/ats/pipelines/${encodeURIComponent(pipelineRef)}/move`, body),

  applications: {
    list: (opts: { jobPostingId?: string; status?: string; candidateRef?: string } = {}): Promise<AtsApplication[]> => {
      const query = new URLSearchParams();
      if (opts.jobPostingId) query.set('jobPostingId', opts.jobPostingId);
      if (opts.status) query.set('status', opts.status);
      if (opts.candidateRef) query.set('candidateRef', opts.candidateRef);
      const suffix = query.toString() ? `?${query}` : '';
      return apiRequest<{ applications: AtsApplication[] }>(`/api/ats/applications${suffix}`).then((r) => r.applications);
    },

    /** The candidate drawer's ONE read: the application, the résumé, the decisions and
     *  the offers, composed server-side. */
    read: (applicationId: number): Promise<AtsCandidateDossier> =>
      apiRequest<AtsCandidateDossier>(`/api/ats/applications/${applicationId}`),

    /** Admitting a candidate and recording their application are one act. */
    record: (body: { jobPostingId: string; userId?: string; candidateRef?: string; source?: string; coverLetter?: string }): Promise<{ candidateRef: string; resumeProjected: boolean; applicationId: number | null }> =>
      post('/api/ats/applications', body),

    reject: (applicationId: number, reason: string): Promise<{ movedTo: string | null; movedFrom: string | null }> =>
      post(`/api/ats/applications/${applicationId}/reject`, { reason }),

    decisions: (applicationId: number): Promise<AtsDecision[]> =>
      apiRequest<{ decisions: AtsDecision[] }>(`/api/ats/applications/${applicationId}/decisions`).then((r) => r.decisions),

    /** Recording a decision IS the move — there is no second click. */
    decide: (applicationId: number, body: { decision: string; rationale?: string; evidence?: Record<string, unknown> }): Promise<{ decision: AtsDecision; movedTo: string | null; movedFrom: string | null }> =>
      post(`/api/ats/applications/${applicationId}/decisions`, body),
  },

  kits: {
    list: (): Promise<AtsKit[]> => apiRequest<{ kits: AtsKit[] }>('/api/ats/kits').then((r) => r.kits),
    /** Seed (or fetch) the house loop, so the editor never opens empty. */
    ensureDefault: (): Promise<AtsKit> => post<{ kit: AtsKit }>('/api/ats/kits/default').then((r) => r.kit),
    create: (body: { name: string; roleFamily?: string | null; description?: string | null; isDefault?: boolean; stages?: AtsKitStageInput[] }): Promise<AtsKit> =>
      post<{ kit: AtsKit }>('/api/ats/kits', body).then((r) => r.kit),
    update: (kitId: number, body: { name?: string; roleFamily?: string | null; description?: string | null; isDefault?: boolean; stages?: AtsKitStageInput[] }): Promise<AtsKit> =>
      patch<{ kit: AtsKit }>(`/api/ats/kits/${kitId}`, body).then((r) => r.kit),
    remove: (kitId: number): Promise<void> =>
      apiRequest<{ ok: true }>(`/api/ats/kits/${kitId}`, { method: 'DELETE' }).then(() => undefined),
  },

  offers: {
    list: (opts: { applicationId?: number; candidateRef?: string; status?: string } = {}): Promise<AtsOffer[]> => {
      const query = new URLSearchParams();
      if (opts.applicationId) query.set('applicationId', String(opts.applicationId));
      if (opts.candidateRef) query.set('candidateRef', opts.candidateRef);
      if (opts.status) query.set('status', opts.status);
      const suffix = query.toString() ? `?${query}` : '';
      return apiRequest<{ offers: AtsOffer[] }>(`/api/ats/offers${suffix}`).then((r) => r.offers);
    },
    draft: (body: {
      applicationId?: number | null; candidateRef?: string | null; title: string;
      baseSalary?: number | null; currency?: string; equity?: string | null;
      startDate?: string | null; expiresAt?: string | null; terms?: Record<string, unknown> | null;
    }): Promise<AtsOffer> => post<{ offer: AtsOffer }>('/api/ats/offers', body).then((r) => r.offer),
    update: (offerId: number, body: Record<string, unknown>): Promise<AtsOffer> =>
      patch<{ offer: AtsOffer }>(`/api/ats/offers/${offerId}`, body).then((r) => r.offer),
    /**
     * Send for signature, through the platform's one signature engine.
     *
     * The invitation tokens come back ONCE and are not recoverable — that is the engine's
     * contract, and this response is the only place they ever exist.
     */
    send: (offerId: number, body: { parties: Array<{ name: string; email: string }>; remindAfterDays?: number }): Promise<AtsSentOffer> =>
      post(`/api/ats/offers/${offerId}/send`, body),
    respond: (offerId: number, response: 'accepted' | 'declined', note?: string): Promise<{ offer: AtsOffer; movedTo: string | null }> =>
      post(`/api/ats/offers/${offerId}/respond`, { response, note }),
  },
};
