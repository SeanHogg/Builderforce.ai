/**
 * Realizations — idea → something a person can open (the proof forms, their
 * plan/build/grade loop, the measure that grades them and the founder's
 * journey signal). Split out of `builderforceApi.ts` so that module does not
 * keep growing; the Challenge types it builds on stay there (type-only import,
 * so no runtime cycle). Each act the method counts emits its `methodEvents`
 * event on success.
 */

import type { ProofEvaluationDto, ProofJourneySignalDto, ProofMeasure } from '@builderforce/interaction-contract';
import { apiRequest as request } from './apiClient';
import type {
  BackendStrategyKey,
  ChallengeBuildResult,
  ChallengePlan,
  ChallengeSpec,
  HostingStrategySummary,
} from './builderforceApi';
import { emitMethodEvent } from './methodEvents';

/** The eight proof forms. Mirrors `REALIZATION_KEYS` on the API. */
export type RealizationKey =
  | 'demo-video'
  | 'clickable-prototype'
  | 'smoke-test'
  | 'wizard-of-oz'
  | 'poc'
  | 'pilot'
  | 'phone-line'
  | 'live-system';

export interface RealizationTargetSummary {
  key: RealizationKey;
  name: string;
  summary: string;
  /** The question a stakeholder is really asking when they ask for this one. */
  answers: string;
  /** 1 = a sketch of the idea, 5 = the thing itself. */
  fidelity: number;
  /** 1 = an afternoon, 5 = weeks. */
  effort: number;
  suits: string[];
  hasBackend: boolean;
  /** Only the live system lets you choose which cloud it runs in. */
  allowsStrategyChoice: boolean;
}

export interface RealizationRecommendation {
  key: RealizationKey;
  score: number;
  reasons: string[];
  recommended: boolean;
}

/** What the success criteria decided. Mirrors `REALIZATION_VERDICTS` on the API. */
export type RealizationVerdict = 'met' | 'missed' | 'abandoned';

/** The number that decided it — shape varies by target (a signup count against
 *  a sample, a pass rate against a trial count), so this stays loose rather
 *  than forcing one schema onto every proof. */
export interface RealizationVerdictMetric {
  metricLabel?: string;
  metricValue?: number;
  target?: number;
  note?: string;
  [key: string]: unknown;
}

export interface Realization {
  id: string;
  challengeId: string | null;
  projectId: number | null;
  /** The Creation Session whose idea this proof is of, when it had one. */
  sessionId: string | null;
  targetKey: RealizationKey;
  title: string;
  strategy: BackendStrategyKey;
  status: 'planned' | 'building' | 'built' | 'failed';
  /** The address a person can open. Null until it has been built and published. */
  liveUrl: string | null;
  spec: ChallengeSpec;
  plan: ChallengePlan;
  error: string | null;
  /** Null until a console has called it, or a person has parked the idea. */
  verdict: RealizationVerdict | null;
  verdictMetric: RealizationVerdictMetric | null;
  decidedAt: string | null;
  /** What visitor behaviour grades it (PRD 33 §5.3.1); null when the target's criteria are not visitor behaviour. */
  measure?: ProofMeasure | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RealizationBuildResult extends ChallengeBuildResult {
  liveUrl: string | null;
  publishedAssets: number;
  collections: string[];
}

export const realizationApi = {
  targets: (): Promise<{ targets: RealizationTargetSummary[]; strategies: HostingStrategySummary[] }> =>
    request<{ targets: RealizationTargetSummary[]; strategies: HostingStrategySummary[] }>('/api/realizations/targets'),

  list: (sessionId?: string): Promise<Realization[]> =>
    request<{ realizations: Realization[] }>(
      sessionId ? `/api/realizations?sessionId=${encodeURIComponent(sessionId)}` : '/api/realizations',
    ).then((r) => r.realizations),

  /** Reading it also rolls its verdict up; a read that changed the grade is the method's `proof.grade` act. */
  get: (id: string): Promise<Realization> =>
    request<{ realization: Realization; verdictChanged?: boolean }>(`/api/realizations/${encodeURIComponent(id)}`).then((r) => {
      if (r.verdictChanged) emitMethodEvent('proof.grade');
      return r.realization;
    }),

  /** Reading an idea persists nothing — except, when the idea belongs to a
   *  board, that a READ happened. That is what `readBeforeBuildRate` counts.
   *  `priorRealizationId` reads it again with that graded proof's evidence (PRD 33 §5.3.3). */
  plan: (idea: string, sessionId?: string | null, opts: { priorRealizationId?: string | null } = {}): Promise<{
    spec: ChallengeSpec;
    recommendations: RealizationRecommendation[];
    targets: RealizationTargetSummary[];
  }> =>
    request<{ spec: ChallengeSpec; recommendations: RealizationRecommendation[]; targets: RealizationTargetSummary[] }>('/api/realizations/plan', {
      method: 'POST',
      body: JSON.stringify({
        idea,
        ...(sessionId ? { sessionId } : {}),
        ...(opts.priorRealizationId ? { priorRealizationId: opts.priorRealizationId } : {}),
      }),
    }).then((r) => {
      emitMethodEvent('idea.read');
      return r;
    }),

  /** Choose a proof and plan it. Still builds nothing. */
  create: (input: {
    idea?: string;
    challengeId?: string;
    projectId?: number;
    /** The board whose idea this proves. Recorded on the row, and the reason the
     *  loop's outcome events have a session to attach to. */
    sessionId?: string | null;
    targetKey: RealizationKey;
    strategy?: BackendStrategyKey;
  }): Promise<Realization> =>
    request<{ realization: Realization }>('/api/realizations', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => {
      emitMethodEvent('proof.choose');
      return r.realization;
    }),

  /** Build it, publish it, wire its forms. Idempotent. */
  build: (id: string): Promise<{ realization: Realization | null; result: RealizationBuildResult }> =>
    request<{ realization: Realization | null; result: RealizationBuildResult }>(
      `/api/realizations/${encodeURIComponent(id)}/build`,
      { method: 'POST' },
    ).then((r) => {
      emitMethodEvent('proof.build');
      return r;
    }),

  /** The proof's standing against its measure (the scoreboard's one read); null when it has none. */
  measure: (id: string): Promise<ProofEvaluationDto | null> =>
    request<ProofEvaluationDto>(`/api/realizations/${encodeURIComponent(id)}/measure`, { expectedErrors: [404] })
      .catch((error: unknown) => {
        if ((error as { status?: number } | null)?.status === 404) return null;
        throw error;
      }),

  /** Grade it now, before the window ends. The reason is required and kept on the record. */
  callEarly: (id: string, reason: string): Promise<Realization> =>
    request<{ realization: Realization }>(`/api/realizations/${encodeURIComponent(id)}/call-early`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
      expectedErrors: [400, 403, 409],
    }).then((r) => r.realization),

  /** Where the newest proof puts the founder: Make, Measure, or no signal. */
  journeySignal: (): Promise<ProofJourneySignalDto> =>
    request<ProofJourneySignalDto>('/api/realizations/journey-signal'),

  remove: (id: string): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/api/realizations/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** Park it. The one verdict typed by a person rather than read from a
   *  console — met/missed only ever come from the proof's own console. */
  abandon: (id: string, note?: string): Promise<Realization> =>
    request<{ realization: Realization }>(`/api/realizations/${encodeURIComponent(id)}/verdict`, {
      method: 'PATCH',
      body: JSON.stringify({ verdict: 'abandoned', ...(note ? { note } : {}) }),
    }).then((r) => r.realization),
};
