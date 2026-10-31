/**
 * Governance for a CLI-backend run (`runCliAgent`, the one entry the auto-reply, cron and command
 * paths all share, including as a fallback model).
 *
 * A CLI backend is a subprocess that runs its own tools, launched with its permission prompts
 * skipped (`cli-backends.ts`). Nothing at the tool seam can see its calls, so a `block` or
 * `require-approval` gate cannot be enforced on it, and the only restraint left is a line of prompt
 * that the model may ignore. A blocked tool running unattended on a permissions-skipped subprocess
 * is the worst case, so this FAILS CLOSED:
 *
 *   - any `block` or `require-approval` gate in force ⇒ the CLI provider is refused, with an error
 *     `runWithModelFallback` treats as failover-eligible, so an embedded candidate takes over (that
 *     path enforces the gate). With no embedded candidate the run fails and the message names the
 *     gates;
 *   - directive-only gates are guidance, not a restraint: they are rendered into the CLI's system
 *     prompt by the ONE renderer;
 *   - a host whose gates could not be fetched and holds none runs, with the warning
 *     `resolveHostPolicyGates` logs (the same as the embedded path).
 */

import { renderPolicyDirectives, type PolicyGate } from "@builderforce/agent-tools";
import { resolveHostPolicyGates } from "../../infra/host-policy-gates.js";
import { FailoverError } from "../failover-error.js";

/** A gate the CLI subprocess cannot be held to. */
const isUnenforceable = (gate: PolicyGate): boolean => gate.effect === "block" || gate.effect === "require-approval";

function describeGate(gate: PolicyGate): string {
  return `${gate.id} (${gate.effect} ${gate.tool ?? "all tools"})`;
}

/**
 * The governance directives to add to a CLI run's system prompt ("" when none).
 * Throws a failover-eligible `FailoverError` when an enforceable gate is in force.
 */
export async function governCliRun(target: { provider: string; model?: string }): Promise<string> {
  const gates = await resolveHostPolicyGates();
  const unenforceable = gates.filter(isUnenforceable);
  if (unenforceable.length > 0) {
    throw new FailoverError(
      `The ${target.provider} CLI backend cannot be held to this tenant's governance gates, so it was not used. ` +
        `Gates in force: ${unenforceable.map(describeGate).join(", ")}.`,
      {
        // not a provider fault (nothing to cool down or retry): the model is simply not allowed, so the next candidate runs
        reason: "unknown",
        provider: target.provider,
        ...(target.model ? { model: target.model } : {}),
      },
    );
  }
  return renderPolicyDirectives(gates);
}
