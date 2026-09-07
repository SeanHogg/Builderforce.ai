/**
 * What to do with a turn that ended WITHOUT calling a tool — the decision half of the
 * on-prem stall recovery, kept out of the loop so the loop only performs effects.
 *
 * Detection and the user-facing wording live once in `@builderforce/agent-stall`, shared
 * with the Brain run loop and the server addressed-reply loop. What is on-prem-specific
 * is the MODEL: here a `Model` is a resolved object on the operator's own hardware, not
 * a gateway id, so the failover seam trades in {@link Model}s and identifies them by
 * {@link modelRef}. Everything else — the re-prompt budget, the failover budget, the
 * "never hand back the model that just failed" guard — is the shared decision.
 *
 * Pure: no streams, no messages, no I/O. `tried` is the one mutation, and it is the
 * shared function's own contract (it appends the model it just burned).
 */

import {
  chooseStallFailover,
  isExhaustedStall,
  modelFailoverNotice,
  shouldRecoverStalledTurn,
  stallExhaustedNotice,
  stallRecoveryNudge,
  stallShape,
  MAX_ANNOUNCEMENT_RECOVERIES,
  type StallShape,
} from "@builderforce/agent-stall";
import type { Model } from "../model/types.js";

/** How the stall failover IDENTIFIES a model. On-prem the same model id is served by
 *  several providers (`ollama/qwen3` and `openrouter/qwen3` are different routes with
 *  different failure modes), so the id alone cannot say what has already been tried —
 *  the ref is the pair. One owner, because a picker has to compare against the same
 *  strings this module puts in `tried`. */
export function modelRef(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
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
  /** Every {@link modelRef} burned this run. MUTATED — the active model is appended. */
  triedModels: string[];
  /** Re-prompts already spent against `activeModel`. */
  recoveriesUsed: number;
  /** Model swaps already spent this run. */
  failoversUsed: number;
  /** Where a successor comes from; omitted ⇒ this run never substitutes a model. */
  pickFallbackModel?: ((tried: readonly string[]) => Model | undefined) | undefined;
}

/**
 * Decide what a no-tool-calls turn earns: nothing, another re-prompt, a different
 * model, or an explained stop.
 *
 * Order matters and is the same everywhere: spend the re-prompt budget on THIS model
 * first (a model that narrates once usually acts when told to), and only once that is
 * exhausted ask whether a different model should take over. `pickFallbackModel` absent
 * — the on-prem default, because a self-hosted model is an operator's explicit pin —
 * collapses the third step into the fourth, which is exactly the behaviour this loop
 * had before the seam existed.
 */
export function resolveStallOutcome(input: StallDecisionInput): StallOutcome {
  const stallInput = {
    text: input.facts.text,
    toolCallCount: 0,
    availableToolCount: input.facts.availableToolCount,
    recoveriesUsed: input.recoveriesUsed,
    availableToolNames: input.facts.availableToolNames,
    requestText: input.facts.requestText,
  };
  // An autonomous run has NOBODY to hand commands to — a turn that ends "now run the
  // tests and commit" is a no-op dressed as a completed step, and the ticket ledger
  // records it as done. Same budget, different correction; see `stallShape`.
  const shape = stallShape(stallInput);

  if (shouldRecoverStalledTurn(stallInput)) {
    const recoveriesUsed = input.recoveriesUsed + 1;
    return {
      kind: "nudge",
      nudge: stallRecoveryNudge(recoveriesUsed >= MAX_ANNOUNCEMENT_RECOVERIES, shape),
      recoveriesUsed,
      shape,
    };
  }
  if (!isExhaustedStall(stallInput)) {
    return { kind: "none" };
  }

  // Every recovery spent and the model is STILL only describing calls (or handing them
  // to a user who isn't there). Re-prompting IT again is spent; only a different model
  // finishes the request. The shared decision records what has been tried, enforces the
  // failover budget, and refuses to hand back a model that already failed.
  const activeRef = modelRef(input.activeModel);
  let candidate: Model | undefined;
  const next = input.pickFallbackModel
    ? chooseStallFailover({
        activeModel: activeRef,
        tried: input.triedModels,
        failoversUsed: input.failoversUsed,
        pick: (tried) => {
          candidate = input.pickFallbackModel?.(tried);
          return candidate ? modelRef(candidate) : undefined;
        },
      })
    : undefined;
  if (next && candidate && modelRef(candidate) === next) {
    return {
      kind: "failover",
      model: candidate,
      notice: modelFailoverNotice(activeRef, next, shape),
      // The incoming model starts with a full stall budget — the outgoing one's failures
      // say nothing about it, and carrying the count over would give it no chance.
      nudge: stallRecoveryNudge(false, shape),
      failoversUsed: input.failoversUsed + 1,
      shape,
    };
  }
  // No `pickFallbackModel` ⇒ `chooseStallFailover` never ran, so the model that just
  // burned its budget is not yet in `tried`. Record it here so the notice names it and
  // a later failover (once a host wires one up) cannot hand it back.
  if (!input.triedModels.includes(activeRef)) {
    input.triedModels.push(activeRef);
  }
  return {
    kind: "exhausted",
    notice: stallExhaustedNotice(activeRef, input.triedModels, shape),
    shape,
  };
}
