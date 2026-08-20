/**
 * `@builderforce/learned-routing` — Learned Model Routing (PRD 13), the half that
 * is NOT a Worker.
 *
 * Everything here is pure and dependency-free so the cloud router (Worker) and the
 * on-prem / IDE host (Node) can seed from the same learned ranking, label work with
 * the same action taxonomy, spell the same scope token, and write back through the
 * same payload contract — without either side importing the other's runtime.
 *
 * What lives here (and therefore lives in exactly ONE place):
 *   • `actionTypes`        — the closed action-type vocabulary + the kill switch
 *   • `modelQualityScore`  — outcome/rating blend + the rate-limit availability test
 *   • `rankModels`         — `rankModelsForAction`, the pure re-ranker
 *   • `routingScope`       — `project:<id> | tenant:<id> | global` and its token
 *   • `runOutcomeContract` — the `POST /llm/v1/run-outcome` body + its parser
 *
 * What does NOT live here: anything that touches KV, a DB, an env binding or the
 * network. The routing-table blob, its reconcile and its cache stay in the api.
 */

export {
  ACTION_TYPES,
  DEFAULT_ACTION_TYPE,
  actionTypeLabel,
  learnedRoutingEnabled,
  normalizeActionType,
  type ActionType,
} from './actionTypes.js';

export {
  RATE_LIMIT_DEMOTE_THRESHOLD,
  RATE_LIMIT_MIN_RUNS,
  blendedQualityScore,
  isChronicallyRateLimited,
  qualityEvidence,
  ratingScore,
  type ModelQualitySignals,
} from './modelQualityScore.js';

export {
  DEFAULT_MIN_SAMPLES,
  rankModelsForAction,
  scopeHasSignal,
  type ActionModelRankStat,
  type RankModelsOptions,
} from './rankModels.js';

export {
  OWN_TENANT_SCOPE_TOKEN,
  parseScopeToken,
  scopeToken,
  type RoutingScope,
} from './routingScope.js';

export {
  MODEL_ANALYTICS_PATH,
  RUN_OUTCOME_PATH,
  parseRunOutcomeRequest,
  type NormalizedRunOutcome,
  type OutcomeSource,
  type RunOutcomeRequest,
  type TerminalStatus,
} from './runOutcomeContract.js';
