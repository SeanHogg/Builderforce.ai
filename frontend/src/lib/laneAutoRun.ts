/**
 * Board "autonomous trigger" decision — the single source of truth for what
 * happens when a ticket enters a lane (column). Used by the drag-drop handler
 * (and any other lane-entry path) so they agree on whether to auto-start a run
 * AND which agent that run executes as.
 *
 * The bug this fixes: dropping a ticket into a lane configured with a cloud agent
 * (e.g. a "Coder Agent (V2)") auto-started a run but never passed the lane's
 * agent, so the backend fell back to the generic V1 gateway-default — the wrong
 * agent on a weak fallback model.
 */

/** Minimal shape of a configured lane agent needed to start a run AS it. */
export interface LaneAgentLike {
  runtime: string;
  agentRef: string | null;
  model: string | null;
}

export interface LaneAutoRunDecision {
  /** Whether dropping a ticket into this lane should auto-start a run. */
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
 *   • Lane has a configured cloud agent → autonomous trigger: run AS that agent
 *     (pass its ref + model), gated by the board's master `autonomous` switch.
 *   • No configured cloud agent (default columns / unconfigured board) → preserve
 *     the legacy behaviour: auto-run on the active statuses with no pinned agent
 *     (the backend then falls back to the ticket's assignee or gateway default).
 */
export function decideLaneAutoRun(
  agents: LaneAgentLike[] | undefined,
  status: string,
  boardAutonomous: boolean,
): LaneAutoRunDecision {
  const agent = (agents ?? []).find((a) => a.runtime === 'cloud' && !!a.agentRef);
  if (agent?.agentRef) {
    return boardAutonomous
      ? { autoRun: true, cloudAgentRef: agent.agentRef, model: agent.model ?? undefined }
      : { autoRun: false };
  }
  return { autoRun: LEGACY_AUTO_RUN_STATUSES.has(status) };
}
