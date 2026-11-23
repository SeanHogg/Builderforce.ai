/**
 * The run's ROUTE: held ONCE on the run context (`BrainRunContext.route`), decided by `routeRun` from `@builderforce/agent-run`
 * (the one place the pipeline route, the start phase and the quick model are decided — nothing here scores or classifies).
 * This only builds that decision's INPUT from the Brain's request and maps its result onto the per-call metadata, so the
 * preamble (policy start, usage metadata), the settle (verify skip) and `openRun` (`run/runPrepared.ts`) all read one value.
 *
 * Only a host that sends {@link BrainRunRequest.pipeline} is routed; a sub-agent (`lineage`) never is — it is a slice its
 * owner already planned, and keeps its `code` start.
 */

import { routeRun, type RouteInput } from '@builderforce/agent-run';
import type { CompletionMetadata } from '../streamChatCompletion';
import type { BrainRunRequest } from './runTypes';

/** The run's decided route plus the input it was decided from (handed to `openRun` as-is). */
export type RunRoute = ReturnType<typeof routeRun> & { input: RouteInput };

/** The route input for one run: its request, whether it follows an earlier turn, and the host's routing and stage models. */
export function routeInputOf(
  req: Pick<BrainRunRequest, 'pipeline' | 'phaseModels' | 'modelStrict' | 'lineage'>,
  request: string,
  followUp: boolean,
): RouteInput {
  return {
    request,
    followUp,
    ...(req.pipeline ? { routing: { mode: req.pipeline.routing, ...(req.pipeline.threshold !== undefined ? { threshold: req.pipeline.threshold } : {}), ...(req.pipeline.quickModel !== undefined ? { quickModel: req.pipeline.quickModel } : {}) } } : {}),
    ...(req.phaseModels ? { phaseModels: req.phaseModels } : {}),
    ...(req.modelStrict ? { modelStrict: true } : {}),
    ...(req.lineage ? { child: true } : {}),
  };
}

/** Decide the run's route, once, in the preamble. */
export function decideRoute(req: Parameters<typeof routeInputOf>[0], request: string, followUp: boolean): RunRoute {
  const input = routeInputOf(req, request, followUp);
  return { ...routeRun(input), input };
}

/** The keys every call of a routed run carries — to the gateway's row and the device's. */
export function routeMetadata(route: Pick<RunRoute, 'pipeline'>): Pick<CompletionMetadata, 'pipelineRoute' | 'routeScore'> {
  return route.pipeline ? { pipelineRoute: route.pipeline.route, routeScore: route.pipeline.score } : {};
}
