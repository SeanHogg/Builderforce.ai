/**
 * policy/model/handoff.ts — the model policy's per-turn hand-off, for the agent to call
 * around the transport: what a turn ASKS for (role, phase, strictness, exclusions) and how
 * a failed turn is routed around.
 *
 * Ports `cloudAgent/cloudRunModelPolicy.ts` `completeUnderRunPolicy`: when the transport
 * answers a failure the policy routes around (a released pin or lock on 429/413/503, a
 * declined turn, a transient failure under auto-routing) the turn is re-asked ONCE on the
 * cascade; a failure it does not route around fails the turn as it is. `runTurn.ts` owns
 * WHEN this runs; this file owns WHAT the policy decides.
 *
 * No `node:*` imports, no DOM.
 */

import { nextTurn, type TurnRequest } from "@builderforce/run-policy";
import type { RunState } from "../../contract.js";
import { recordSuccess, retryOutcome, routeAroundFailure } from "./index.js";

/** What one turn asks of the transport, beyond the transcript. */
export interface TurnAsk {
  model?: string;
  role: string;
  phase: string;
  strict?: boolean;
  excludeModels?: string[];
  toolChoice?: "auto" | "required";
}

/** The model state in the shape the policy's helpers take (the extras live on the run's state elsewhere). */
function asModelRunState(state: RunState) {
  return { policy: state.model, stallRecoveries: 0, preflightNotices: [] as readonly string[] };
}

function askOf(req: TurnRequest & { toolChoice?: "required" }, phase: string): TurnAsk {
  return {
    ...(req.model ? { model: req.model } : {}),
    role: req.role,
    phase,
    ...(req.strict ? { strict: true } : {}),
    ...(req.excludeModels.length > 0 ? { excludeModels: req.excludeModels } : {}),
    ...(req.toolChoice ? { toolChoice: req.toolChoice } : {}),
  };
}

/**
 * A transport failure: let the policy route around it. Returns the re-ask and what the
 * hand-off released, or null when the failure is one the policy does not route around.
 * The reduced policy is written back to the state either way (the failure is recorded).
 */
export function routeAround(
  state: RunState,
  status: number | undefined,
): { retry: TurnAsk; from: string | null; released: boolean } | null {
  const request = nextTurn(state.model, { hasTools: true });
  const routed = routeAroundFailure(asModelRunState(state), request, { kind: "transport", ...(status !== undefined ? { status } : {}) });
  state.model = routed.state.policy;
  const outcome = retryOutcome(routed.state);
  if (!routed.retry || !outcome) return null;
  const released = outcome.released;
  return {
    retry: askOf(routed.retry, state.model.phase),
    from: typeof released === "string" ? released : null,
    released: Boolean(released),
  };
}

/** The turn succeeded: lock onto what served it (when configured to) and record it proven when it acted. */
export function turnSucceeded(state: RunState, served: { model?: string; acted: boolean }): void {
  state.model = recordSuccess(asModelRunState(state), { ...(served.model ? { model: served.model } : {}), acted: served.acted }).policy;
  // The forced tool choice was one-shot: this request spent it.
  delete state.forceToolChoice;
}
