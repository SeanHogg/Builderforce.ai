/**
 * The confirm chip's estimate (PRD 38 §3.1/§4.3): the plan's model calls, and — when the host
 * can price a call — what they ≈ cost. The price is the HOST's port (the router, not this
 * package, knows which model a call lands on): on the web and Rovr it is the SERVER's answer
 * (`clientCallPrice`, `GET …/knowledge/judge/estimate`); with none, the estimate carries only
 * the calls and the chip says the cost is shown after routing. A call that runs on the
 * person's own local model carries `local`, and the chip says so instead of a price.
 */

import type { ReviewPlan } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeClient } from '@builderforce/knowledge-client';
import type { ReviewEstimate } from '@builderforce/knowledge-graph-view';
import type { KnowledgeDegradedReporter } from './directorySourceKit';

/** A call that runs on the person's own local model — free, and said so. */
export interface LocalCallPrice { local: true }

/** ≈ USD of one judgement call, a local call, or undefined when the host cannot say yet. */
export type CallPrice = number | LocalCallPrice | undefined;
export type CallPricePort = () => CallPrice | Promise<CallPrice>;

/** The ONE price port for hosts that reach the knowledge API: the server prices the call. */
export function clientCallPrice(client: Pick<KnowledgeClient, 'judgeEstimate'>): CallPricePort {
  return async () => {
    const estimate = await client.judgeEstimate();
    return estimate.local ? { local: true } : estimate.perCallUsd ?? undefined;
  };
}

export async function estimateReview(plan: ReviewPlan, price: CallPricePort | undefined, onDegraded: KnowledgeDegradedReporter): Promise<ReviewEstimate> {
  const modelCalls = plan.estimatedModelCalls;
  let perCall: CallPrice;
  try {
    perCall = price ? await price() : undefined;
  } catch (error) {
    onDegraded('review price', error, { rootId: plan.rootId });
  }
  if (typeof perCall === 'object' && perCall.local) return { modelCalls, costUsd: 0, local: true };
  return typeof perCall === 'number' && Number.isFinite(perCall) && perCall >= 0
    ? { modelCalls, costUsd: modelCalls * perCall }
    : { modelCalls };
}
