/**
 * What to do with a turn that ended WITHOUT calling a tool — the decision half of the
 * on-prem stall recovery, kept out of the loop so the loop only performs effects.
 *
 * The decision itself is THE shared one: `resolveStallStep` over the run's model
 * hand-off policy (`@builderforce/run-policy`), the same step the Brain, the server
 * addressed reply and the cloud loops take — the re-prompt budget, the failover budget
 * and the "never hand back the model that just failed" guard all live there. What is
 * on-prem-specific is the MODEL: here a `Model` is a resolved object on the operator's
 * own hardware, not a gateway id, so the policy tracks models by {@link modelRef} and
 * this module maps the ref the policy chose back to the {@link Model} the picker
 * resolved.
 *
 * Pure: no streams, no messages, no I/O.
 */

import { initialRunPolicy, resolveStallStep, type RunPolicyState } from "@builderforce/run-policy";
import type { StallShape } from "@builderforce/agent-stall";
import type { Model } from "../model/types.js";

/** How the stall failover IDENTIFIES a model. On-prem the same model id is served by
 *  several providers (`ollama/qwen3` and `openrouter/qwen3` are different routes with
 *  different failure modes), so the id alone cannot say what has already been tried —
 *  the ref is the pair. One owner, because a picker has to compare against the same
 *  strings the policy puts in `tried`. */
export function modelRef(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

/** The run's hand-off policy, pinned to the operator's model. An on-prem pin is the
 *  operator's explicit choice: it is never released or routed around in transport —
 *  only a stall failover onto the operator's own declared chain moves off it. */
export function initialOnPremRunPolicy(model: Model): RunPolicyState {
  return initialRunPolicy({ pinnedModel: modelRef(model) });
}

/** What the loop knows about the turn that just ended with zero tool calls. */
interface StallTurnFacts {
  /** Visible assistant text — what the USER was left holding. */
  text: string;
  /** Tools the model COULD have called this turn. */
  availableToolCount: number;
  /** Their names, for the handoff detector. */
  availableToolNames: string[];
  /** The request the run was given (not a nudge this loop wrote itself). */
  requestText: string;
}

/** The loop's next move. `shape` rides along on every acting outcome so the caller can
 *  record WHAT the model did without re-deriving it. */
type StallOutcome =
  | { kind: "none" }
  /** Re-prompt the SAME model. */
  | { kind: "nudge"; nudge: string; recoveriesUsed: number; shape: StallShape | null }
  /** Switch models and re-prompt. `notice` is the user-facing explanation of the swap. */
  | {
      kind: "failover";
      model: Model;
      notice: string;
      nudge: string;
      failoversUsed: number;
      shape: StallShape | null;
    }
  /** Nothing left to try — record `notice` so the run's emptiness is explained. */
  | { kind: "exhausted"; notice: string; shape: StallShape | null };

interface StallDecisionInput {
  facts: StallTurnFacts;
  /** The model this turn ran on. */
  activeModel: Model;
  /** The run's hand-off policy ({@link initialOnPremRunPolicy}). */
  policy: RunPolicyState;
  /** Re-prompts already spent against `activeModel`. */
  recoveriesUsed: number;
  /** Where a successor comes from; omitted ⇒ this run never substitutes a model. */
  pickFallbackModel?: ((tried: readonly string[]) => Model | undefined) | undefined;
}

/**
 * Decide what a no-tool-calls turn earns: nothing, another re-prompt, a different
 * model, or an explained stop — and the policy state after it.
 *
 * `pickFallbackModel` absent — the on-prem default, because a self-hosted model is an
 * operator's explicit pin — collapses the failover into the explained stop, which is
 * exactly the behaviour this loop had before the seam existed.
 */
export function resolveStallOutcome(input: StallDecisionInput): { policy: RunPolicyState; outcome: StallOutcome } {
  const pickFallbackModel = input.pickFallbackModel;
  // The policy trades in refs; remember the Model behind the ref the picker offered.
  let candidate: Model | undefined;
  const { policy, step } = resolveStallStep(
    input.policy,
    {
      text: input.facts.text,
      toolCallCount: 0,
      availableToolNames: input.facts.availableToolCount > 0 ? input.facts.availableToolNames : [],
      requestText: input.facts.requestText,
      resolvedModel: modelRef(input.activeModel),
    },
    input.recoveriesUsed,
    pickFallbackModel
      ? {
          pick: (tried) => {
            candidate = pickFallbackModel(tried);
            return candidate ? modelRef(candidate) : undefined;
          },
        }
      : {},
  );
  switch (step.kind) {
    case "none":
      return { policy, outcome: { kind: "none" } };
    case "nudge":
      return { policy, outcome: { kind: "nudge", nudge: step.nudge, recoveriesUsed: step.recoveriesUsed, shape: step.shape } };
    case "failover":
      if (candidate && modelRef(candidate) === step.to) {
        return {
          policy,
          outcome: {
            kind: "failover",
            model: candidate,
            notice: step.notice,
            nudge: step.nudge,
            failoversUsed: step.attempt,
            shape: step.shape,
          },
        };
      }
      // Unreachable while the picker is the only source; refuse to switch to a ref we
      // cannot resolve to a Model rather than guess.
      return { policy: input.policy, outcome: { kind: "exhausted", notice: step.notice, shape: step.shape } };
    case "exhausted":
      return { policy, outcome: { kind: "exhausted", notice: step.notice, shape: step.shape } };
  }
}
