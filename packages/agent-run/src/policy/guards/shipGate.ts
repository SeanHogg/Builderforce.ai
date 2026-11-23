/**
 * policy/guards/shipGate — the publish refusal (PRD 48 §4.2), moved here from the cloud adapter so the
 * policy lives in the agent and a surface hands only its PORT.
 *
 * Every raw shell push, pull request or merge the MODEL asks for is refused BEFORE it dispatches by THE publish gate
 * every host shares (`publishAllowed`, `@builderforce/run-guards`). The run reads the refusal and carries on; it is
 * never turned into a question. It wraps the guards hook's `beforeDispatch` slot rather than the shell capability, so
 * a host's own branch push (not a tool call) is never refused.
 */
import { publishAllowed, type ShipHost, type ShipPolicy } from "@builderforce/run-guards";
import type { GuardsHook } from "../hooks.js";

/** What a surface hands over to have its publish refused: the ship policy and where a refusal is recorded. */
export interface PublishGatePort {
  policy: ShipPolicy;
  /** Told of every refusal (the tool and the reason), for the surface's own record. */
  onRefused?: (tool: string, error: string) => Promise<void> | void;
  /** Only words the refusal. Default `cloud`. */
  host?: ShipHost;
}

/** The guards hook with the ship policy's publish refusal in front of every call. No gate ⇒ unchanged. */
export function withShipGate(guards: GuardsHook, gate: PublishGatePort | undefined): GuardsHook {
  if (!gate) return guards;
  return {
    ...guards,
    beforeDispatch: async (ctx, call) => {
      const verdict = publishAllowed(gate.policy, call.name, call.args, gate.host ?? "cloud");
      if (!verdict.ok) {
        await gate.onRefused?.(call.name, verdict.error);
        return { skip: { data: { ok: false, error: verdict.error }, isError: true } };
      }
      return guards.beforeDispatch?.(ctx, call);
    },
  };
}
