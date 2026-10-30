/**
 * What a child run is, derived from its owner's (PRD 35 §6): a sub-agent is the SAME agent
 * with its own transcript — a CLONE of its owner, one level down, with the same catalog.
 * The adapter supplies the ports a child runs on; WHAT a child holds, which policy it runs
 * under and how its outcome reads to the owner are the agent's, so they are here and no
 * adapter restates them.
 *
 *   - {@link childPolicy}: the owner's policy narrowed to a child — its own tool scope and
 *     role, no delegation request of its own, no verify and no sign-off (the OWNER is held
 *     to those for the whole tree);
 *   - {@link childProvider}: the owner's capabilities minus what a child mechanically
 *     cannot do (`childCapabilities`, the cloud's rule — one source in `agent-tools`) and
 *     the services behind them;
 *   - {@link childResult}: the child's outcome as the `spawn_agent` result its owner reads.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser and Node.
 */

import {
  childCapabilities,
  clipChildOutput,
  type CapabilityProvider,
  type SubagentRequest,
  type SubagentResult,
} from "@builderforce/agent-tools";
import type { RunOutcome, RunPolicy } from "../../contract.js";

/** The owner's policy, narrowed to one of its children. */
export function childPolicy(parent: RunPolicy, request: Pick<SubagentRequest, "role">): RunPolicy {
  const { signoff: _ownersSignoff, ...rest } = parent;
  return {
    ...rest,
    toolScope: "subagent",
    role: request.role ?? parent.role,
    verify: "none",
    delegation: { requested: false, readsBeforeNudge: parent.delegation.readsBeforeNudge },
  };
}

/**
 * The owner's capabilities as a child holds them: the same set minus what is never
 * delegable (`human`, `skill.author`) and minus delegation itself — a child spawns no
 * children of its own here — together with the services those capabilities back.
 */
export function childProvider(parent: CapabilityProvider): CapabilityProvider {
  const { orchestration: _orchestration, human: _human, skillAuthor: _skillAuthor, ...kept } = parent;
  return { ...kept, capabilities: childCapabilities(parent.capabilities, false) };
}

/** A child's outcome as the result its owner reads (`outputChars` caps a fan-out's share). */
export function childResult(outcome: RunOutcome, request: Pick<SubagentRequest, "outputChars" | "ticket">): SubagentResult {
  switch (outcome.kind) {
    case "finished":
      return {
        ok: true,
        output: request.outputChars ? outcome.output.slice(0, request.outputChars) : clipChildOutput(outcome.output),
        steps: outcome.state.step,
        ...(request.ticket ? { ticket: request.ticket } : {}),
      };
    case "paused":
      return { ok: false, error: `the sub-agent stopped to ask a person: ${outcome.question}` };
    case "yielded":
      return { ok: true, output: "", truncated: true, steps: outcome.state.step };
    case "failed":
      return { ok: false, error: outcome.reason };
  }
}
