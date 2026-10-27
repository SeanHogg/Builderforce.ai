/**
 * `@builderforce/pipeline-route` — decide once per run whether a request takes the FULL
 * pipeline (plan → code → verify) or a QUICK single coding pass, and the pure math of
 * the route report. No I/O: the run store decides (`brain-embedded` run preamble) and
 * the VS Code host renders the report from its local usage ledger.
 */

export {
  DEFAULT_ROUTE_THRESHOLD,
  LENGTH_FLOOR_CHARS,
  MAX_FILE_MENTIONS,
  ROUTE_WEIGHTS,
  pipelineFeaturesOf,
  routeThreshold,
  scorePipeline,
  type PipelineFeatures,
  type PipelineRoute,
  type PipelineRoutingMode,
  type PipelineScore,
  type PipelineScoreOptions,
  type RouteWeights,
} from './score.js';
export {
  MIN_QUICK_RUNS_FOR_SUGGESTION,
  MISROUTE_HIGH,
  MISROUTE_LOW,
  RERUN_WINDOW_MS,
  misroutedRuns,
  suggestThreshold,
  summarizeRouteRuns,
  type RouteReport,
  type RouteRunRecord,
  type RouteTotals,
  type ScoreBin,
} from './report.js';

/** Is `raw` a pipeline route? For values read back from storage or the wire. */
export function isPipelineRoute(raw: unknown): raw is 'full' | 'quick' {
  return raw === 'full' || raw === 'quick';
}
