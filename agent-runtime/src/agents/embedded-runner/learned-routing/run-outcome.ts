/**
 * Learned Model Routing (PRD 13) — what ONE embedded run will teach the fleet.
 *
 * Filled in as the run learns it (the action label at seed time, the model it actually LOCKED ONTO
 * as failover resolves) and reported once, after the run has terminated. It lives outside the run
 * body because that has many exits — a timeout return, a normal return, a thrown FailoverError —
 * and a report attached to only some of them would teach the learner a survivorship-biased table in
 * which models mostly succeed.
 *
 * The two judgements in a report are THE shared ones, not this runner's own:
 *   - `rateLimited`: the failure says a model or pool was throttled (`isRateLimitFailure`, the rule
 *     the cloud classifier and the ONE agent's row read) — not this runner's failover reason, which
 *     also matches a tenant's spent quota and would demote a model for it;
 *   - `degraded`: served by a WEAKER model than asked (`isWeakerModel`, the model catalog's tier rule).
 */

import { DEFAULT_ACTION_TYPE, isRateLimitFailure, type ActionType } from "@builderforce/learned-routing";
import { isWeakerModel } from "@builderforce/model-catalog";
import { isFailoverError } from "../../failover-error.js";
import { completeLearnedRun, type CompleteRunInput } from "./index.js";

/** A provider-qualified model, as the runner knows it. */
export interface ModelRef {
  provider: string;
  model: string;
}

export interface RunOutcomeState {
  actionType: ActionType;
  provider: string;
  model: string;
  steps: number;
  degraded: boolean;
}

export function trackRunOutcome(input: { runId: string; isProbeSession: boolean }) {
  const outcome: RunOutcomeState = {
    actionType: DEFAULT_ACTION_TYPE,
    provider: "",
    model: "",
    steps: 0,
    degraded: false,
  };
  const qualified = (ref: ModelRef): string => `${ref.provider}/${ref.model}`;

  return {
    outcome,
    /** The model the run LOCKED ONTO, and whether that is a weaker one than it asked for. */
    lockOnto(served: ModelRef, asked: ModelRef): void {
      outcome.provider = served.provider;
      outcome.model = served.model;
      if (isWeakerModel(qualified(asked), qualified(served))) outcome.degraded = true;
    },
    /** ONE report per run, on every exit. Fire-and-forget: `completeLearnedRun` never throws. */
    report(terminalStatus: CompleteRunInput["terminalStatus"], error?: unknown): void {
      if (!outcome.model || input.isProbeSession) return;
      void completeLearnedRun({
        runId: input.runId,
        model: qualified(outcome),
        actionType: outcome.actionType,
        terminalStatus,
        rateLimited: isFailoverError(error) && isRateLimitFailure(error.message),
        degraded: outcome.degraded,
        steps: outcome.steps,
      });
    },
  };
}
