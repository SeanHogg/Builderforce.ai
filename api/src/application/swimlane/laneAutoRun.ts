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
   * The BACKPLANE the lane staffed this agent on — `swimlane_agent_assignments.runtime`
   * ('local' | 'cloud' | 'remote' | 'browser'). The autonomous trigger used not to read
   * this column at all, so a lane deliberately staffed to an on-prem machine was handed
   * to the cloud dispatcher anyway: the operator's runtime choice was silently discarded
   * on every drag. Carried through the decision so the dispatcher can honour it.
   */
  runtime?: LaneAgentRuntime | null;
  /**
   * The agent-host id this assignment pins, when `runtime` is 'remote' (or 'browser',
   * where it names the browser worker). Null for 'cloud'/'local'.
   */
  target?: string | null;
  /**
   * True for the ticket-OWNER fallback appended by {@link withOwnerAgentFallback}.
   * The router never reorders it ahead of explicit lane staffing: staffing is a
   * deliberate configuration, an owner is a default.
   */
  isOwnerFallback?: boolean;
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

/**
 * The backplanes a lane agent assignment can name. Mirrors `agent_assignments.runtime`,
 * which is nullable — migration 1085 folded lane staffing into a table shared with
 * scopes that have no backplane at all, so every read has to narrow the raw varchar.
 *
 * THE ONE name for this union. `compileStage` declared a second, identical
 * `AssignmentRuntime`, which is how a column with four legal values came to have two
 * type-level definitions that could drift apart while both compiled.
 */
export type LaneAgentRuntime = 'local' | 'cloud' | 'remote' | 'browser';

/**
 * Narrow the raw `agent_assignments.runtime` varchar to the union, or to null.
 *
 * An unrecognised value is treated as UNSET rather than as 'cloud': the dispatcher then
 * applies its ordinary host-pin/cloud resolution instead of acting on a typo. Callers
 * that must have a backplane apply their own `?? 'cloud'` — which is a different
 * decision, made where its consequence is visible.
 */
export function normalizeLaneAgentRuntime(raw: string | null | undefined): LaneAgentRuntime | null {
  return raw === 'local' || raw === 'cloud' || raw === 'remote' || raw === 'browser' ? raw : null;
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
  /** The backplane the chosen lane agent is staffed on — see {@link LaneAgentLike.runtime}. */
  runtime?: LaneAgentRuntime;
  /** The agent-host the chosen lane agent pins, when `runtime` is 'remote'/'browser'. */
  target?: string;
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
 * What a lane is FOR, expressed as capability slugs, when the lane's staffing declares
 * no `required_capabilities` of its own.
 *
 * These are NOT a gate. An un-configured lane has always accepted whichever agent was
 * staffed first, and hard-requiring a slug here would refuse lanes that run today. They
 * are the ROUTER's expectation: when several agents qualify for a lane, the one whose
 * skills actually match the lane's work is picked, instead of whichever row happened to
 * be inserted first. A lane with an explicit requirement keeps using it, unchanged.
 *
 * Keys are `TaskStatus` values (a lane's key IS the status).
 */
export const LANE_DEFAULT_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  backlog:     ['planning', 'analysis', 'product'],
  todo:        ['planning', 'analysis'],
  ready:       ['coding', 'engineering'],
  in_progress: ['coding', 'engineering', 'implementation'],
  in_review:   ['review', 'code-review', 'qa', 'testing'],
  blocked:     ['analysis', 'debugging', 'investigation'],
};

/**
 * How well an agent's resolved capabilities match what a lane is for. Higher is better;
 * 0 means "nothing matched", which is the score every agent gets on a lane with no
 * expectation — so scoring never changes the answer where there is nothing to weigh.
 *
 * Deliberately generous: a slug counts when it CONTAINS an expected term (a
 * `senior-coding-agent` skill matches `coding`), because capability slugs are
 * free-text and an exact-match router would score almost every real tenant at zero.
 */
export function scoreLaneAgent(
  agent: Pick<LaneAgentLike, 'capabilities'>,
  expected: readonly string[] | undefined,
): number {
  if (!expected || expected.length === 0) return 0;
  const have = (agent.capabilities ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (have.length === 0) return 0;
  let score = 0;
  for (const want of expected) {
    const term = want.trim().toLowerCase();
    if (!term) continue;
    if (have.some((h) => h === term || h.includes(term) || term.includes(h))) score++;
  }
  return score;
}

/**
 * The lane's capability expectation: its staffing's explicit `required_capabilities`
 * when it set any, else the lane-key default. Used ONLY for ranking.
 */
export function laneCapabilityExpectation(
  agents: readonly LaneAgentLike[],
  laneKey: string | null | undefined,
): readonly string[] {
  const explicit = agents.flatMap((a) => a.requiredCapabilities ?? []);
  if (explicit.length > 0) return [...new Set(explicit)];
  return LANE_DEFAULT_CAPABILITIES[(laneKey ?? '').trim()] ?? [];
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
  /** The lane's key, so the router can weigh candidates against what the lane is FOR.
   *  Omitted → no ranking, which is exactly the pre-router behaviour. */
  laneKey?: string | null,
): LaneAutoRunDecision {
  if (laneGate === 'human') return { autoRun: false };
  const configured = (agents ?? []).filter((a): a is LaneAgentLike & { agentRef: string } => !!a.agentRef);
  if (configured.length === 0) return { autoRun: false };

  // ── THE GATE ────────────────────────────────────────────────────────────────────
  // Partition first, in ASSIGNMENT order, so every mismatch is recorded whichever
  // agent ends up winning. (Ranking before the gate would hide the mismatches of
  // agents the router happened to sort behind the winner — the diagnosis a
  // mis-staffed lane depends on.)
  const capabilityMismatches: CapabilityMismatch[] = [];
  const qualified: (LaneAgentLike & { agentRef: string })[] = [];
  for (const agent of configured) {
    const missing = missingCapabilities(agent.requiredCapabilities, agent.capabilities);
    if (missing.length === 0) qualified.push(agent);
    else capabilityMismatches.push({ agentRef: agent.agentRef, missing });
  }

  // Every configured agent failed its capability requirement — do not silently run
  // a mismatched agent; surface why so the lane staffing can be corrected.
  if (qualified.length === 0) return { autoRun: false, capabilityMismatches };

  // ── THE ROUTER ──────────────────────────────────────────────────────────────────
  // The guardrail only ever REFUSED an unqualified agent; among agents that qualified
  // it took whichever row was inserted first. On a lane staffed with several agents
  // that is a coin flip: the reviewer could take the implementation lane because it was
  // added first. Rank by how well each matches what the lane is FOR — stably (equal
  // scores keep assignment order), with the owner fallback pinned last, because
  // staffing is a decision and an owner is a default.
  const expectation = laneCapabilityExpectation(configured, laneKey);
  const chosen = expectation.length === 0
    ? qualified[0]!
    : qualified
      .map((agent, index) => ({ agent, index, score: agent.isOwnerFallback ? -1 : scoreLaneAgent(agent, expectation) }))
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))[0]!.agent;

  return {
    autoRun: true,
    agentRef: chosen.agentRef,
    model: chosen.model ?? undefined,
    ...(chosen.runtime ? { runtime: chosen.runtime } : {}),
    ...(chosen.target ? { target: chosen.target } : {}),
    ...(capabilityMismatches.length > 0 ? { capabilityMismatches } : {}),
  };
}

/**
 * Append the ticket's OWNER agent (`tasks.assigned_agent_ref`) to a lane's agent
 * list as the LOWEST-priority candidate, so a ticket explicitly assigned to a
 * cloud agent auto-runs AS that agent even when the lane carries no explicit
 * swimlane staffing — closing the "I assigned Ada to this ticket, why isn't she
 * working it" gap (assigning an agent as a ticket's owner is itself the "go").
 *
 * Explicit lane agents keep precedence: {@link decideLaneAutoRun} tries the list
 * in order, so staffing wins and the owner is only reached when no lane agent
 * qualifies (or the lane has none). The owner is capability-unconstrained — the
 * lane pinned no `required_capabilities` to it — so it always qualifies. No-op
 * when there is no owner agent, or the owner is already a configured lane agent
 * (so the run is never attributed to it twice).
 */
export function withOwnerAgentFallback(
  laneAgents: LaneAgentLike[] | undefined,
  owner: { agentRef: string | null | undefined; model?: string | null } | undefined,
): LaneAgentLike[] {
  const list: LaneAgentLike[] = [...(laneAgents ?? [])];
  const ref = owner?.agentRef?.trim();
  if (ref && !list.some((a) => a.agentRef?.trim() === ref)) {
    // The OWNER fallback names no backplane: assigning an agent as a ticket's owner
    // says who works it, not where. Leaving runtime unset lets the dispatcher apply its
    // normal host-pin/cloud resolution, which is what the fallback always did.
    list.push({ agentRef: ref, model: owner?.model ?? null, requiredCapabilities: null, capabilities: null, runtime: null, target: null, isOwnerFallback: true });
  }
  return list;
}
