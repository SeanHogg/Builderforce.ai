/**
 * The confirm chip's estimate (PRD 38 §4.3): the plan's model calls, and — when the host
 * can price a call — what they ≈ cost. The price is the HOST's port (the router, not this
 * package, knows which model a call lands on); with none, the estimate carries only the
 * calls and the chip says the cost is shown after routing.
 */

import type { ReviewPlan } from '@seanhogg/builderforce-memory/knowledge';
import type { ReviewEstimate } from '@builderforce/knowledge-graph-view';
import type { KnowledgeDegradedReporter } from './directorySourceKit';

/** ≈ USD of one judgement call, or undefined when the host cannot say yet. */
export type CallPricePort = () => number | undefined | Promise<number | undefined>;

export async function estimateReview(plan: ReviewPlan, price: CallPricePort | undefined, onDegraded: KnowledgeDegradedReporter): Promise<ReviewEstimate> {
  const modelCalls = plan.estimatedModelCalls;
  let perCall: number | undefined;
  try {
    perCall = price ? await price() : undefined;
  } catch (error) {
    onDegraded('review price', error, { rootId: plan.rootId });
  }
  return perCall !== undefined && Number.isFinite(perCall) && perCall >= 0
    ? { modelCalls, costUsd: modelCalls * perCall }
    : { modelCalls };
}
