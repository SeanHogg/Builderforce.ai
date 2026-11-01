/**
 * What the Brain's model port adds to its stream (PRD 35 §4 WS4): two rules of the request, not of the stream, so they sit beside
 * `brainModelTransport` instead of in it.
 *
 *   - the host's fallback ({@link brainModelRules}): a stalled model fails over onto the one the host picks from what the run
 *     already tried (`BrainRunRequest.pickFallbackModel`, which the web and Rovr hosts answer with `nextFallbackModel`);
 *   - a host that advertises tools but cannot run them ({@link withoutUncallableTurns}, applied by the prepared run): a call
 *     nobody can execute is not a call, so the turn is a final answer.
 */

import type { ModelTransport } from '@builderforce/agent-run';
import type { BrainRunRequest } from '../runStore/runTypes';

export function brainModelRules(model: ModelTransport, req: Pick<BrainRunRequest, 'pickFallbackModel'>): ModelTransport {
  const { pickFallbackModel } = req;
  return pickFallbackModel ? { ...model, pickFallback: (tried: readonly string[]) => pickFallbackModel(tried) } : model;
}

/** The turns of a host that cannot run a tool carry no calls (`completeTurn.ts`: "a tool call nobody can execute is not a tool call"). */
export function withoutUncallableTurns(model: ModelTransport, req: Pick<BrainRunRequest, 'runTool'>): ModelTransport {
  if (req.runTool) return model;
  return { ...model, complete: async (request, signal) => ({ ...(await model.complete(request, signal)), toolCalls: [] }) };
}
