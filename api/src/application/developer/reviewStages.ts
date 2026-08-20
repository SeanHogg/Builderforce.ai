/**
 * The review pipeline's COMPOSITION ROOT.
 *
 * `reviewPipeline.ts` owns the registry, the order and the precedence rules and
 * imports none of the stages — which is what lets its rules be tested against
 * fake stages, and what stops a module that owns four decisions from also owning
 * a dependency on the connector runtime, a sandbox workspace and an LLM gateway.
 *
 * This file is the other half: the one place that says which stages this
 * deployment actually runs. Registration is an explicit CALL rather than an
 * import side effect, because an import whose only purpose is a side effect is
 * the one a reader deletes as unused and a bundler is entitled to drop — and the
 * failure mode of dropping it is a review pipeline that silently runs one stage
 * and approves everything the static parser accepts.
 *
 * Adding the human stage of PRD 24 §5.5 is one more line here.
 */

import { registerReviewStage } from './reviewPipeline';
import { dynamicStage } from './dynamicReview';
import { agenticStage } from './agenticReview';

let installed = false;

/** Idempotent. Called by every path that runs a review. */
export function installReviewStages(): void {
  if (installed) return;
  registerReviewStage(dynamicStage);
  registerReviewStage(agenticStage);
  installed = true;
}
