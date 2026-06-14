/**
 * Server-side canonical decision for the board "autonomous trigger": when a
 * ticket ENTERS a lane (created into it, or moved into it by ANY path — board
 * drag, status dropdown, the brain, a raw API PATCH), decide whether to
 * auto-start a run AND as which cloud agent.
 *
 * This logic used to live ONLY in the frontend (`patchStatus` →
 * `runtimeApi.submitExecution`), so any status change that did not flow through
 * the board component — a brain-created ticket, an API PATCH, a status set from
 * another surface — silently skipped the autonomous run. That is the reported
 * bug: a ticket dropped into a lane with a configured cloud agent just sat there.
 * The trigger now lives server-side on the task PATCH/create path (taskRoutes),
 * so it fires no matter which client moved the ticket. The frontend mirror has
 * been removed; this is the single source of truth.
 */

/** Minimal shape of a configured lane agent needed to start a run AS it. */
export interface LaneAgentLike {
  runtime: string;
  agentRef: string | null;
  model: string | null;
}

export interface LaneAutoRunDecision {
  /** Whether a ticket entering this lane should auto-start a run. */
  autoRun: boolean;
  /** The cloud agent the run executes AS (the lane's configured agent), if any. */
  cloudAgentRef?: string;
  /** The lane agent's pinned model, if it configured one. */
  model?: string;
}

/** Statuses that auto-run on a board with NO configured lane agents (the
 *  out-of-the-box default columns). Keeps the pre-board behaviour intact. */
const LEGACY_AUTO_RUN_STATUSES: ReadonlySet<string> = new Set(['todo', 'in_progress']);

/**
 * Decide whether a ticket entering a lane should auto-start an execution, and AS
 * which agent.
 *
 * Autonomy is per-LANE, not board-level: a lane with a configured agent + an
 * `auto` gate fires on its own; a `human` gate waits for explicit approval.
 *
 *   • Lane has a configured cloud agent + non-human gate → run AS that agent
 *     (pass its ref + model so the backend resolves the right engine/model).
 *   • Lane has a configured cloud agent + `human` gate → no auto-run (waits).
 *   • No configured cloud agent (default columns) → legacy: auto-run on the
 *     active statuses with no pinned agent (the backend falls back to the
 *     ticket's assignee or the gateway default).
 */
export function decideLaneAutoRun(
  agents: LaneAgentLike[] | undefined,
  status: string,
  laneGate: 'auto' | 'human' | undefined,
): LaneAutoRunDecision {
  const agent = (agents ?? []).find((a) => a.runtime === 'cloud' && !!a.agentRef);
  if (agent?.agentRef) {
    if (laneGate === 'human') return { autoRun: false };
    return { autoRun: true, cloudAgentRef: agent.agentRef, model: agent.model ?? undefined };
  }
  return { autoRun: LEGACY_AUTO_RUN_STATUSES.has(status) };
}
