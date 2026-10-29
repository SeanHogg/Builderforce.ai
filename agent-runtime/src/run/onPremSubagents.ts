/**
 * `childRunner` — how an on-prem run delegates: a sub-agent is the SAME agent (PRD 35 §6),
 * run through `runAgent` with its own transcript, the parent's model and the parent's
 * tools. It sees none of the parent's conversation; its brief is its whole task.
 *
 * This is the on-prem backing of the shared `spawn_agent` tool (`OrchestrationCapability`),
 * and the replacement for the SDK's `Task` tool. Recursion is impossible by construction:
 * the child's capability set does not include `orchestrate`, so it is never offered the tool.
 *
 * It supplies ports and nothing else: no loop, no policy. What a delegation means for the
 * run (the nudge, the backstop) is `policy/subagents`'.
 */

import { runAgent } from "@builderforce/agent-run";
import type { EventSink, HumanChannel, ModelTransport, RunPolicy } from "@builderforce/agent-run";
import {
  clipChildOutput,
  type Capability,
  type CapabilityProvider,
  type SubagentRequest,
  type SubagentResult,
} from "@builderforce/agent-tools";

/** What a child inherits from the run that spawns it. */
export interface ChildRunContext {
  model: ModelTransport;
  /** The parent's capabilities; the child gets the same set minus `orchestrate*`. */
  capabilities: CapabilityProvider;
  human: HumanChannel;
  policy: RunPolicy;
  /** The parent's sink: a child writes its OWN outcome row, never the parent's trace. */
  events: EventSink;
  /** Stopping the parent stops the child. */
  signal?: AbortSignal;
  /** The parent's execution id, so the child's dispatch names its owner. */
  parentRunId?: string;
}

/** The child's capabilities: the parent's, without the ability to delegate further. */
function withoutDelegation(parent: CapabilityProvider): CapabilityProvider {
  const caps = new Set<Capability>(
    [...parent.capabilities].filter((c) => c !== "orchestrate" && !c.startsWith("orchestrate.")),
  );
  const { orchestration: _delegated, ...rest } = parent;
  return { ...rest, capabilities: caps };
}

/** The `OrchestrationCapability.spawn` for one parent run. */
export function childRunner(parent: ChildRunContext): (request: SubagentRequest) => Promise<SubagentResult> {
  return async (request) => {
    const policy: RunPolicy = {
      ...parent.policy,
      toolScope: "subagent",
      role: request.role ?? parent.policy.role,
      delegation: { requested: false, readsBeforeNudge: parent.policy.delegation.readsBeforeNudge },
    };
    const outcome = await runAgent({
      task: {
        prompt: request.task,
        dispatch: { source: "subagent", ...(parent.parentRunId ? { parentRunId: parent.parentRunId } : {}) },
      },
      policy,
      ports: {
        model: parent.model,
        capabilities: withoutDelegation(parent.capabilities),
        // A child is one invocation: nothing resumes it, so nothing is kept.
        store: { load: () => undefined, save: () => undefined },
        events: { emit: () => undefined, ...(parent.events.outcome ? { outcome: parent.events.outcome } : {}) },
        human: parent.human,
        context: { pack: () => ({ focus: [], facts: [], recall: [] }) },
      },
      ...(parent.signal ? { signal: parent.signal } : {}),
    });
    // A fan-out shares one result between its children, so it names its own cap.
    const clip = (text: string): string => (request.outputChars ? text.slice(0, request.outputChars) : clipChildOutput(text));
    switch (outcome.kind) {
      case "finished":
        return { ok: true, output: clip(outcome.output), steps: outcome.state.step, ...(request.ticket ? { ticket: request.ticket } : {}) };
      case "paused":
        return { ok: false, error: `the sub-agent stopped to ask a person: ${outcome.question}` };
      case "yielded":
        return { ok: true, output: "", truncated: true, steps: outcome.state.step };
      case "failed":
        return { ok: false, error: outcome.reason };
    }
  };
}
