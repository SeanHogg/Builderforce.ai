/**
 * Server-side canonical decision for the board "autonomous trigger": when a
 * ticket ENTERS a lane (created into it, or moved into it by ANY path — board
 * drag, status dropdown, the brain, a raw API PATCH), decide whether to
 * auto-start a run AND as which agent.
 *
 * This logic used to live ONLY in the frontend (`patchStatus` →
 * `runtimeApi.submitExecution`), so any status change that did not flow through
 * the board component — a brain-created ticket, an API PATCH, a status set from
 * another surface — silently skipped the autonomous run. That is the reported
 * bug: a ticket dropped into a lane with a configured agent just sat there. The
 * trigger now lives server-side on the task PATCH/create path (taskRoutes), so it
 * fires no matter which client moved the ticket.
 *
 * There is ONE agent engine (the V2 Agent) and ONE surface-aware dispatcher: the
 * agent's backplane — Durable Object, Container, or an on-prem machine (a
 * long-lived runtime, equivalent to a container) — is resolved downstream by the
 * dispatcher, NOT decided here. This decision only answers "does this lane
 * auto-run, and as which agent" and hands the agent ref to that single dispatcher.
 */

/** Minimal shape of a configured lane agent needed to start a run AS it. */
export interface LaneAgentLike {
  agentRef: string | null;
  model: string | null;
  /**
   * Capability slugs (skill + persona) the LANE requires the agent to have for
   * this lane's work — the `required_capabilities` configured on the swimlane
   * agent assignment. Empty/absent → no requirement (the agent always qualifies).
   */
  requiredCapabilities?: string[] | null;
  /**
   * The agent's RESOLVED capabilities (its assigned skill + persona slugs). The
   * guardrail checks `requiredCapabilities ⊆ capabilities`; a docs/BA agent with
   * no coding capabilities is skipped for a lane that requires them rather than
   * silently running the wrong agent on a coding task.
   */
  capabilities?: string[] | null;
}

/** One lane agent that was skipped because it lacked the lane's required capabilities. */
export interface CapabilityMismatch {
  agentRef: string;
  /** Required capability slugs the agent does NOT have. */
  missing: string[];
}

export interface LaneAutoRunDecision {
  /** Whether a ticket entering this lane should auto-start a run. */
  autoRun: boolean;
  /** The agent the run executes AS (the lane's configured agent), if any. */
  agentRef?: string;
  /** The lane agent's pinned model, if it configured one. */
  model?: string;
  /**
   * Lane agents that were skipped because they did not satisfy the lane's
   * required capabilities. Present whenever the guardrail rejected at least one
   * agent — surfaced by the caller as a `capability_mismatch` warning so a
   * mis-staffed lane is diagnosable instead of silently not running.
   */
  capabilityMismatches?: CapabilityMismatch[];
}

/**
 * The required capabilities an agent is MISSING. Empty when nothing is required
 * or the agent has every required slug. Case-insensitive slug compare so a
 * configured `Coding-Agent` requirement matches a resolved `coding-agent` skill.
 */
export function missingCapabilities(
  required: string[] | null | undefined,
  have: string[] | null | undefined,
): string[] {
  if (!required || required.length === 0) return [];
  const haveSet = new Set((have ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean));
  return required
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && !haveSet.has(r.toLowerCase()));
}

/**
 * Decide whether a ticket entering a lane should auto-start an execution, and AS
 * which agent.
 *
 * Autonomy is per-LANE, not board-level: a lane with a configured agent + an
 * `auto` gate fires on its own; a `human` gate waits for explicit approval; a
 * lane with no configured agent does not auto-run.
 *
 * Capability guardrail: among the lane's configured agents (in assignment order),
 * pick the FIRST one that satisfies its lane assignment's `requiredCapabilities`.
 * An agent that lacks a required capability is skipped (recorded in
 * `capabilityMismatches`) rather than dispatched — so a documentation/BA agent is
 * never auto-assigned a lane that requires coding capabilities. When NO agent
 * qualifies, the lane does not auto-run and the mismatches explain why.
 */
export function decideLaneAutoRun(
  agents: LaneAgentLike[] | undefined,
  laneGate: 'auto' | 'human' | undefined,
): LaneAutoRunDecision {
  if (laneGate === 'human') return { autoRun: false };
  const configured = (agents ?? []).filter((a): a is LaneAgentLike & { agentRef: string } => !!a.agentRef);
  if (configured.length === 0) return { autoRun: false };

  const capabilityMismatches: CapabilityMismatch[] = [];
  for (const agent of configured) {
    const missing = missingCapabilities(agent.requiredCapabilities, agent.capabilities);
    if (missing.length === 0) {
      return {
        autoRun: true,
        agentRef: agent.agentRef,
        model: agent.model ?? undefined,
        ...(capabilityMismatches.length > 0 ? { capabilityMismatches } : {}),
      };
    }
    capabilityMismatches.push({ agentRef: agent.agentRef, missing });
  }
  // Every configured agent failed its capability requirement — do not silently run
  // a mismatched agent; surface why so the lane staffing can be corrected.
  return { autoRun: false, capabilityMismatches };
}
