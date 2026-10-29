/**
 * policy/model/failure — a provider that broke under a completion is routed around, not
 * surfaced (PRD 35 §6.8; the Creation Canvas's `recoverFromProviderFailure`, ported).
 *
 * The TRANSPORT classifies (it knows its own errors) and throws a
 * {@link ModelTransportFailure}; this decides. In the order every browser loop took:
 *
 *   1. a model that already ACTED in this run takes over — the stall ladder's hand-off
 *      (`handOffToProven`, the one place it is made), drawing only on proven models;
 *   2. otherwise the failure is reported to the run policy exactly as the server loops
 *      report a failed response, and its outcome decides: a retry on the gateway's pool
 *      with the broken model left out, or the end of the turn.
 *
 * The wording the model reads, and the surface's trace of the re-route, come from the
 * surface's {@link DeliveryLedger.providerFailure}; with none, the failure is routed in
 * silence.
 */

import { reduceRunPolicy } from "@builderforce/run-policy";
import type { TransportFailure } from "../../surface.js";
import type { FailureRoute, PolicyContext } from "../hooks.js";
import { handOffToProven } from "../stall/ladder.js";

export function recoverProviderFailure(
  ctx: PolicyContext,
  failure: TransportFailure,
  failedModel: string | undefined,
  message: string,
): FailureRoute {
  const ledger = ctx.ports.delivery;
  const wording = ledger?.providerFailure;

  const to = handOffToProven(ctx, ledger, failedModel);
  if (to) return { kind: "retry", ...(wording ? { note: wording.handoff(to) } : {}) };

  const next = reduceRunPolicy(ctx.state.model, failure);
  ctx.state.model = next;
  if (next.outcome.kind === "retry_turn") {
    wording?.rerouted?.({ ...(failedModel ? { model: failedModel } : {}), message, step: ctx.step, outcome: next.outcome });
    return { kind: "retry", ...(wording ? { note: wording.reroute } : {}) };
  }
  wording?.abandoned?.({ ...(failedModel ? { model: failedModel } : {}), message });
  return { kind: "fail" };
}
