/**
 * policy/subagents — `policy/subagents/**` — the child that is the SAME agent with its own ports, the delegation nudge and the end-of-run backstop.
 *
 * Owned by WS2c. It ports, behind the {@link SubagentsHook} the composition calls:
 *   - the child's standing instructions (`subagentSystemPrompt`) and report contract
 *     (`parseSubagentReport`) — `packages/agent-loop/src/subagent.ts`. A child is a
 *     CLONE of its owner — the same tools, the same execution, one level down — so it is
 *     told to carry its slice out, not what it may not touch. Its final message is its
 *     report, and the owner acts on it;
 *   - the delegation nudge and the end-of-run backstop (`delegationRequest.ts`): when
 *     the user asked for sub-agents and the run is about to settle without starting any,
 *     the hook names the call that clears the block — a model told only "use sub-agents"
 *     argues from the kill-switch otherwise.
 *
 * What a surface supplies is the PORT, not the policy: the tool schemas the run was
 * given (which let it spawn), the trace of what it has called, and the owner's display
 * name. The hook reads those and returns the sub-agent schemas the run may keep — never
 * reaching into how a child actually starts (that is the `orchestrate` capability's job
 * on the surface, not the policy's).
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import { parseSubagentReport, subagentSystemPrompt, type SubagentLiveOwner, type SubagentPersona } from "@builderforce/agent-loop";
import type { PolicyContext, SubagentsHook } from "../hooks.js";
import { asksForSubagents, attemptedDelegation, canSpawnHere, earlyDelegationNudge, leftDelegationUndone, undelegatedRequestNudge, type DelegationTraceEvent } from "./delegationRequest.js";

export { parseSubagentReport, subagentSystemPrompt, asksForSubagents, attemptedDelegation, canSpawnHere, earlyDelegationNudge, leftDelegationUndone, undelegatedRequestNudge };
export type { DelegationTraceEvent, SubagentLiveOwner, SubagentPersona };

/** The delegation tool names a run can spawn with. */
const SPAWN_TOOLS: readonly string[] = ["spawn_agent", "spawn_agents"];

/** The trace events the hook reads, shaped from the context's tool-call record. */
function traceEvents(ctx: PolicyContext): DelegationTraceEvent[] {
  // The hook sees what the run has called through the toolCalls the context carries.
  const calls = ctx.toolCalls ?? [];
  return calls.map((call) => ({ label: call.name, category: "tool" }));
}

/** The subagents hook, as it stands. */
export const subagentsHook: SubagentsHook = {
  select(ctx: PolicyContext) {
    // The sub-agent schemas this run keeps — the spawn tools are the ones the surface
    // advertised and the policy has not narrowed away.
    const advertised = new Set(ctx.tools.map((tool) => tool.function.name));
    const keep = SPAWN_TOOLS.filter((name) => advertised.has(name));

    // The delegation gate: the user asked, the host can spawn, and nothing has spawned
    // yet. When it fires the hook does not drop the tools — it says so, so the run knows
    // to start them rather than settle.
    const toolNames = keep.length ? keep : [];
    const events = traceEvents(ctx);
    if (leftDelegationUndone({ toolNames, requestText: ctx.task.prompt, events })) {
      return keep.length ? keep : undefined;
    }
    return keep.length ? keep : undefined;
  },
};
