/**
 * The run's PIPELINE route on a usage row — `full` (plan → code → verify) or `quick`
 * (one coding pass) — and the router's score (`@builderforce/pipeline-route`), lifted out
 * of the caller's metadata into the `pipeline_route` / `route_score` columns (1277 /
 * transactional 0024) so "what does each route cost" is an indexed GROUP BY.
 *
 * The run loop sends both in the `metadata` it already sends with every call (VS Code's
 * run preamble decides the route once per run); a device's own calls carry them in the
 * synced usage payload. Same forgiving promotion as the chat attribution: anything that
 * is not a known route, or not a score in [0, 1], reads as null.
 */

export interface PipelineAttribution {
  pipelineRoute: 'full' | 'quick' | null;
  routeScore: number | null;
}

export function readPipelineAttribution(metadata: Record<string, unknown> | null | undefined): PipelineAttribution {
  if (!metadata || typeof metadata !== 'object') return { pipelineRoute: null, routeScore: null };
  const route = (metadata as { pipelineRoute?: unknown }).pipelineRoute;
  const score = (metadata as { routeScore?: unknown }).routeScore;
  return {
    pipelineRoute: route === 'full' || route === 'quick' ? route : null,
    routeScore: typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1 ? score : null,
  };
}
