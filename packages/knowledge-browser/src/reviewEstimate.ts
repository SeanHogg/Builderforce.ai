/**
 * The confirm chip's estimate (PRD 38 §3.1/§4.3): the plan's model calls, and — when the host
 * can price a call — what they ≈ cost. The price is the HOST's port (the router, not this
 * package, knows which model a call lands on): on the web and Rovr it is the SERVER's answer
 * (`client.judgeEstimate()`, `GET …/knowledge/judge/estimate`). The price model and "calls ×
 * price" are agent-tools' (`reviewCostOf`), shared with the editor and on-prem chat rows; this
 * only maps that cost onto the chip's estimate. With no price the estimate carries only the
 * calls and the chip says the cost is shown after routing; a call on the person's own local
 * model carries `local`, and the chip says so instead of a price.
 */

import type { ReviewPlan } from '@seanhogg/builderforce-memory/knowledge';
import { reviewCostOf, type ReviewCallPrice } from '@builderforce/agent-tools/knowledge';
import type { ReviewEstimate } from '@builderforce/knowledge-graph-view';
import type { KnowledgeDegradedReporter } from './directorySourceKit';

/** ONE judged section's price, or undefined when the host cannot say yet. */
export type CallPricePort = () => ReviewCallPrice | undefined | Promise<ReviewCallPrice | undefined>;

export async function estimateReview(plan: ReviewPlan, price: CallPricePort | undefined, onDegraded: KnowledgeDegradedReporter): Promise<ReviewEstimate> {
  const modelCalls = plan.estimatedModelCalls;
  let perCall: ReviewCallPrice | undefined;
  try {
    perCall = price ? await price() : undefined;
  } catch (error) {
    onDegraded('review price', error, { rootId: plan.rootId });
  }
  const cost = reviewCostOf(modelCalls, perCall);
  if (cost.kind === 'local') return { modelCalls, costUsd: 0, local: true };
  return cost.kind === 'usd' ? { modelCalls, costUsd: cost.usd } : { modelCalls };
}
