/**
 * onPremRunPorts — the ONE on-prem port/policy builder (PRD 35 WS5).
 *
 * The ticket adapter (`onPremAdapter`) and the channel adapter (`channelAdapter`) run the SAME agent on the SAME machine, so what
 * they share is built here once: the policy DATA every on-prem run carries (entry point, role, inference, verify, governance gates,
 * the delegation ask), the in-memory store (an on-prem run is one invocation; nothing resumes it) and the empty context pack.
 * What differs between them — a ticket's relay sinks and steering channel, a channel's `AgentEvent` stream bridge, its closed
 * tool catalog and delivery rungs — stays in the adapter that owns it. Nothing here decides how the run behaves.
 */

import { DEFAULT_READS_BEFORE_NUDGE, asksForSubagents } from "@builderforce/agent-run";
import type { ContextSource, RunPolicy, RunStore } from "@builderforce/agent-run";
import type { PolicyGate } from "@builderforce/agent-tools";

/** The host's context pack when it builds none. */
export const EMPTY_PACK: ContextSource = { pack: () => ({ focus: [], facts: [], recall: [] }) };

export interface OnPremPolicyInput {
  /** Which tool scope the surface's catalog is (`ticket`, `chat-work`). */
  toolScope: RunPolicy["toolScope"];
  /** The request the delegation ask is read from. */
  request: string;
  /** Compiled governance gates. */
  policyGates?: readonly PolicyGate[];
  /** The model the run is pinned to, when the host chose one. */
  pinnedModel?: string;
  /** The surface's own policy data beyond the shared base (levers, hand-off, stall exhaustion). */
  extra?: Partial<RunPolicy>;
}

/** The policy DATA every on-prem run carries. How the run behaves is the agent's. */
export function onPremPolicy(input: OnPremPolicyInput): RunPolicy {
  return {
    entryPoint: "on-prem",
    toolScope: input.toolScope,
    role: "code",
    levers: [],
    budgets: {},
    ...(input.pinnedModel ? { pinnedModel: input.pinnedModel } : {}),
    inference: "hybrid",
    verify: "none",
    approvalGates: [...(input.policyGates ?? [])],
    delegation: { requested: asksForSubagents(input.request), readsBeforeNudge: DEFAULT_READS_BEFORE_NUDGE },
    ...input.extra,
  };
}

/** The store of a one-invocation run: nothing is loaded and nothing kept, but for what the surface names. */
export function inMemoryStore(own: Partial<RunStore> = {}): RunStore {
  return { load: () => undefined, save: () => undefined, ...own };
}
