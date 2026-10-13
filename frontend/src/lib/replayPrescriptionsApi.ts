/**
 * The prescriptions slice of the Insights client (PRD 33 §5.1, §8 S4e) — spread
 * into `replayApi` like `replayAnalysisApi`, so components keep ONE client.
 * Paths are `REPLAY_PATHS`, shapes the shared DTOs (`replayPrescriptionRoutes.ts`
 * produces them).
 *
 * The list is read by several surfaces of one screen at once (Do next, the
 * Overview, the funnel, the heatmap, the player, the proof scoreboard), so it
 * goes through the client read-through cache for a short while; every write
 * (an action, a sweep) invalidates it and tells the subscribers to read again.
 */

import {
  REPLAY_PATHS,
  type ReplayFilter,
  type ReplayPrescriptionActionInput,
  type ReplayPrescriptionActionResultDto,
  type ReplayPrescriptionArea,
  type ReplayPrescriptionDto,
  type ReplayPrescriptionRouteAction,
  type ReplayPrescriptionStatus,
  type ReplayPrescriptionSweepResultDto,
  type ReplayReleaseReportDto,
} from '@builderforce/interaction-contract';
import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';
import { apiRequest } from './apiClient';
import { fill, listOf, shared, withQuery } from './replayHttp';

export interface PrescriptionsQuery {
  area?: ReplayPrescriptionArea | null;
  status?: ReplayPrescriptionStatus | null;
  filter?: ReplayFilter | null;
}

/** "Find fixes now" ran within the hour: the API answers 429 and the card says so. */
export const PRESCRIPTION_SWEEP_LIMIT_STATUS = 429;
/** An action that is not open now, or a fix that changed under the reader. */
export const PRESCRIPTION_CONFLICT_STATUS = 409;

/** How long a read list is reused across the surfaces of one screen. */
export const PRESCRIPTIONS_TTL_MS = 30_000;
const CACHE_PREFIX = `replay:${REPLAY_PATHS.prescriptions}`;
const RELEASE_REPORT_TTL_MS = 60_000;

const listeners = new Set<() => void>();

/** Called after any prescription write; returns the unsubscribe. */
export function subscribePrescriptionChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function changed(): void {
  invalidateClientCache(CACHE_PREFIX);
  invalidateClientCache(`replay:release-report:`);
  for (const listener of [...listeners]) listener();
}

export const replayPrescriptionsApi = {
  /** Ranked: open fixes first (`rank` 1 = do first), then the decided ones. */
  listPrescriptions(siteId: string, query: PrescriptionsQuery = {}): Promise<ReplayPrescriptionDto[]> {
    const url = withQuery(REPLAY_PATHS.prescriptions, siteId, { area: query.area ?? null, status: query.status ?? null }, query.filter);
    return getOrSetClientCached(
      `replay:${url}`,
      async () => listOf(await apiRequest<ReplayPrescriptionDto[] | { items: ReplayPrescriptionDto[] }>(url)),
      { ttlMs: PRESCRIPTIONS_TTL_MS },
    );
  },

  /** One prescription; the API verifies it on read (throttled), so it is never cached here. */
  getPrescription(siteId: string, prescriptionId: string): Promise<ReplayPrescriptionDto> {
    const url = withQuery(fill(REPLAY_PATHS.prescription, { prescriptionId }), siteId);
    return shared(url, () => apiRequest<ReplayPrescriptionDto>(url));
  },

  /**
   * Run one action the card offers (`next`). `follow-up` without `confirm`
   * answers the preview and writes nothing; 409 means the action is no longer open.
   */
  async actOnPrescription(
    siteId: string,
    prescriptionId: string,
    action: ReplayPrescriptionRouteAction,
    input: ReplayPrescriptionActionInput = {},
  ): Promise<ReplayPrescriptionActionResultDto> {
    const url = withQuery(fill(REPLAY_PATHS.prescriptionAction, { prescriptionId, action }), siteId);
    const result = await apiRequest<ReplayPrescriptionActionResultDto>(url, {
      method: 'POST',
      body: JSON.stringify(input),
      expectedErrors: [400, PRESCRIPTION_CONFLICT_STATUS],
    });
    const previewOnly = action === 'follow-up' && input.confirm !== true;
    if (!previewOnly) changed();
    return result;
  },

  /** "Find fixes now" — once an hour per site (429 otherwise). */
  async sweepPrescriptions(siteId: string): Promise<ReplayPrescriptionSweepResultDto> {
    const result = await apiRequest<ReplayPrescriptionSweepResultDto>(withQuery(REPLAY_PATHS.prescriptionSweep, siteId), {
      method: 'POST',
      expectedErrors: [PRESCRIPTION_SWEEP_LIMIT_STATUS],
    });
    changed();
    return result;
  },

  /** The improvement ledger of one release: the fixes it shipped and their verdicts. */
  releaseReport(siteId: string, releaseKey: string): Promise<ReplayReleaseReportDto> {
    const url = withQuery(fill(REPLAY_PATHS.releaseReport, { releaseKey }), siteId);
    return getOrSetClientCached(`replay:release-report:${url}`, () => apiRequest<ReplayReleaseReportDto>(url), { ttlMs: RELEASE_REPORT_TTL_MS });
  },
};
