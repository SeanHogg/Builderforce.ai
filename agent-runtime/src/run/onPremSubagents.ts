/**
 * `childRunner` — how an on-prem run delegates: a sub-agent is the SAME agent (PRD 35 §6),
 * run through `runAgent` with its own transcript, the parent's model and the parent's
 * tools. It sees none of the parent's conversation; its brief is its whole task. This is
 * the backing of the shared `spawn_agent` tool (`OrchestrationCapability`) and the
 * replacement for the SDK's `Task` tool: the call BLOCKS until the child's report is in,
 * as `Task` did.
 *
 * Ports and nothing else. WHAT a child is — its policy, the capabilities it holds, how its
 * outcome reads to the owner — is the agent's (`childPolicy`, `childProvider`,
 * `childResult`); recursion is impossible by construction (a child holds no `orchestrate`).
 *
 * A child is observed on its OWN: its model turns and tool calls go to the host's
 * `forChild` sinks (tagged with its label), never to the owner's chat; and its outcome row
 * names the owner (`parentRunId`) so it is one more row of the owner's tree, not a second
 * run of it.
 */

import { childPolicy, childProvider, childResult, runAgent } from "@builderforce/agent-run";
import type { HumanChannel, ModelTransport, RunPolicy } from "@builderforce/agent-run";
import type { CapabilityProvider, SubagentRequest, SubagentResult } from "@builderforce/agent-tools";
import { observedModel, relayEventSink, type OnPremRunSinks } from "./onPremEvents.js";

/** What a child inherits from the run that spawns it. */
export interface ChildRunContext {
  /** The owner's UNobserved model: the owner's observer would put the child in the owner's chat. */
  model: ModelTransport;
  /** The owner's capabilities; resolved at spawn time (the provider is built after the ports). */
  readonly capabilities: CapabilityProvider;
  policy: RunPolicy;
  /** The owner's sinks: only `forChild` and `onOutcome` are used, never the owner's chat frames. */
  sinks: OnPremRunSinks;
  /** Stopping the owner stops the child. */
  signal?: AbortSignal;
  /** The owner's run id: stamped on the child's dispatch and outcome row. */
  parentRunId: string;
}

/** A child that cannot ask: it is told so by the channel, as the cloud's children are. */
const CHILD_HUMAN: HumanChannel = { ask: async () => ({ kind: "paused" }) };

/** The `OrchestrationCapability.spawn` for one owner run. */
export function childRunner(owner: ChildRunContext): (request: SubagentRequest) => Promise<SubagentResult> {
  return async (request) => {
    const own = owner.sinks.forChild?.(request.label);
    // A child with no observer of its own reports nothing live — it never borrows the owner's.
    const sinks: OnPremRunSinks = own ?? { onAssistantText: () => undefined, onToolUse: () => undefined, onResult: () => undefined };
    const outcome = await runAgent({
      task: { prompt: request.task, dispatch: { source: "subagent", parentRunId: owner.parentRunId } },
      policy: childPolicy(owner.policy, request),
      ports: {
        model: observedModel(owner.model, sinks),
        capabilities: childProvider(owner.capabilities),
        // A child is one invocation: nothing resumes it, so nothing is kept.
        store: { load: () => undefined, save: () => undefined },
        events: relayEventSink(sinks, () => ""),
        human: CHILD_HUMAN,
        context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
      },
      ...(owner.signal ? { signal: owner.signal } : {}),
    });
    return childResult(outcome, request);
  };
}
