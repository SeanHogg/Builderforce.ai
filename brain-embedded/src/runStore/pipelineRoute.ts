/**
 * The run's PIPELINE route, decided ONCE in the run preamble (`runPreamble.ts`) —
 * `full` (plan → code → verify, every run's shape before this) or `quick` (one coding
 * pass: the run starts in `code` on the quick model, offers no `hand_off`, and its
 * finish does not enter the verify stage). The score is `@builderforce/pipeline-route`'s
 * over the user's own request; the action type is the shared lexical classifier's.
 *
 * Only a host that sends {@link BrainRunRequest.pipeline} is routed. A sub-agent never
 * is: it is a slice its owner already planned, and keeps its `code` start.
 */

import { pipelineFeaturesOf, scorePipeline, type PipelineScore } from '@builderforce/pipeline-route';
import type { RunPhase, RunPolicyOptions } from '@builderforce/run-policy';
import { classifyRunAction } from '@builderforce/workload';
import type { CompletionMetadata } from '../streamChatCompletion';
import type { BrainRunRequest } from './runTypes';

export type RunPipeline = PipelineScore;

/** The route for this run, or null when it is not routed. */
export function decideRunPipeline(
  req: Pick<BrainRunRequest, 'pipeline' | 'lineage'>,
  request: string,
  context: { followUp: boolean },
): RunPipeline | null {
  if (!req.pipeline || req.lineage) return null;
  const { actionType } = classifyRunAction(request);
  return scorePipeline(pipelineFeaturesOf(request, { actionType, followUp: context.followUp }), {
    mode: req.pipeline.routing,
    ...(req.pipeline.threshold !== undefined ? { threshold: req.pipeline.threshold } : {}),
  });
}

/**
 * Where the run starts and which model each phase asks for. A sub-agent starts in
 * `code` (see `runPreamble.ts`); a quick run does too, coding on the quick model (else
 * the code model). Every other run plans first.
 */
export function pipelinePolicyOptions(
  req: Pick<BrainRunRequest, 'phaseModels' | 'pipeline' | 'lineage'>,
  pipeline: RunPipeline | null,
): Pick<RunPolicyOptions, 'startPhase' | 'phaseModels'> {
  const quick = pipeline?.route === 'quick';
  const startPhase: RunPhase = req.lineage || quick ? 'code' : 'plan';
  const phaseModels: Partial<Record<RunPhase, string>> = { ...(req.phaseModels ?? {}) };
  const quickModel = req.pipeline?.quickModel?.trim();
  if (quick && quickModel) phaseModels.code = quickModel;
  return { startPhase, ...(Object.keys(phaseModels).length ? { phaseModels } : {}) };
}

/** The keys every call of a routed run carries — to the gateway's row and the device's. */
export function pipelineMetadata(pipeline: RunPipeline | null): Pick<CompletionMetadata, 'pipelineRoute' | 'routeScore'> {
  return pipeline ? { pipelineRoute: pipeline.route, routeScore: pipeline.score } : {};
}

/** A quick run ends on its coding pass: no verify stage. */
export function skipsVerifyStage(pipeline: RunPipeline | null): boolean {
  return pipeline?.route === 'quick';
}
