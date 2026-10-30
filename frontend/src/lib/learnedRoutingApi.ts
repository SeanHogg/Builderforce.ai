import { MODEL_ANALYTICS_PATH, RUN_OUTCOME_PATH, type ActionType, type RunOutcomeRequest } from '@builderforce/learned-routing';
import { apiRequest } from './apiClient';
import { AMBIENT_REQUEST_ERRORS } from './errors/transportFailure';

/**
 * Learned Model Routing's typed client (PRD 13): the per-action-type model ranking the router seeds
 * from, and the one write-back door a settled non-cloud run reports through. Split out of
 * `builderforceApi.ts`.
 */

/** One model's learned ranking within an action type — from `/llm/v1/model-analytics`. */
export interface ModelAnalyticsEntry {
  model: string;
  samples: number;
  avgScore: number;
  mergeRate: number;
  /** null = none of this model's runs reported a cost: unknown, not $0. */
  avgCostMillicents: number | null;
  /** Runs behind that mean that reported a cost. */
  costN?: number;
}
export interface ModelAnalyticsAction {
  actionType: ActionType;
  label: string;
  models: ModelAnalyticsEntry[];
}
export interface ModelAnalyticsResponse {
  scope: string;
  updatedAt: string;
  byAction: ModelAnalyticsAction[];
}

export const learnedRoutingApi = {
  /** The per-action-type model ranking the router seeds from. `scope` defaults to the caller's
   *  tenant; pass `global` or `project:<id>`. */
  modelAnalytics: (scope: string = 'tenant'): Promise<ModelAnalyticsResponse> =>
    apiRequest<ModelAnalyticsResponse>(`${MODEL_ANALYTICS_PATH}?scope=${encodeURIComponent(scope)}`),

  /**
   * Report a settled NON-cloud run (the Creation Canvas, an IDE, on-prem) to the one write-back
   * door: records the run's PRD 35 §8.2 uniform outcome row and — unless the body says
   * `routingSignal: false` — teaches learned routing. Idempotent on `clientRunId`. The body is the
   * shared contract's (`@builderforce/learned-routing`), so no field name is spelled here.
   */
  reportRunOutcome: (body: RunOutcomeRequest): Promise<{ ok: boolean }> =>
    apiRequest<{ ok: boolean }>(RUN_OUTCOME_PATH, { method: 'POST', body: JSON.stringify(body), expectedErrors: AMBIENT_REQUEST_ERRORS }),
};
