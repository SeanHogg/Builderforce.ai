/**
 * The run's ROUTE: held ONCE on the run context (`BrainRunContext.route`), decided by `routeRun` from `@builderforce/agent-run`
 * (the one place the pipeline route, the start phase and the quick model are decided — nothing here scores or classifies).
 * This only builds that decision's INPUT from the Brain's request and maps its result onto the per-call metadata, so the
 * preamble (usage metadata), the settle (verify skip) and `openRun` (`run/runPrepared.ts`, handed `{ input, decided }` so it never routes again) all read one value.
 *
 * Hosts can override the shared default through {@link BrainRunRequest.pipeline}.
 */

import { defaultPipelineRouting, routeRun, type RouteDecision, type RouteInput } from '@builderforce/agent-run';
import type { CompletionMetadata } from '../streamChatCompletion';
import type { BrainRunRequest } from './runTypes';

/** The run's decided route plus the input it was decided from (handed to `openRun` as-is). */
export type RunRoute = ReturnType<typeof routeRun> & { input: RouteInput };

/** The route input for one run: its request, whether it follows an earlier turn, and the host's routing and stage models. */
export function routeInputOf(
  req: Pick<BrainRunRequest, 'pipeline' | 'phaseModels' | 'modelStrict'>,
  request: string,
  followUp: boolean,
): RouteInput {
  return {
    request,
    followUp,
    routing: req.pipeline
      ? { mode: req.pipeline.routing, threshold: req.pipeline.threshold, quickModel: req.pipeline.quickModel }
      : defaultPipelineRouting(),
    ...(req.phaseModels ? { phaseModels: req.phaseModels } : {}),
    ...(req.modelStrict ? { modelStrict: true } : {}),
  };
}

/** Decide the run's route, once, in the preamble. */
export function decideRoute(req: Parameters<typeof routeInputOf>[0], request: string, followUp: boolean): RunRoute {
  const input = routeInputOf(req, request, followUp);
  return { ...routeRun(input), input };
}

/** The decision alone (without the input it was decided from): what `openRun` takes as a route already decided. */
export function decidedRoute(route: RunRoute): RouteDecision {
  return { pipeline: route.pipeline, start: route.start, skipsVerify: route.skipsVerify };
}

/** The keys every call of a routed run carries — to the gateway's row and the device's. */
export function routeMetadata(route: Pick<RunRoute, 'pipeline'>): Pick<CompletionMetadata, 'pipelineRoute' | 'routeScore'> {
  return route.pipeline ? { pipelineRoute: route.pipeline.route, routeScore: route.pipeline.score } : {};
}
