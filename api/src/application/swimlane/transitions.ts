/**
 * Swimlane ticket lifecycle — PURE decision logic (no IO).
 *
 * A "ticket run" is the per-ticket state machine that sits ABOVE the workflow
 * engine. A board is an ordered list of swimlanes (stages); each stage runs a
 * workflow. The lifecycle below tracks where a single ticket is within that
 * pipeline and — critically — encodes the invariant that a FAILED stage NEVER
 * auto-advances the ticket. A failure always routes to `needs_attention` so a
 * human (or an explicit retry) decides what happens next.
 */

/** The full ticket lifecycle status union. */
export type TicketLifecycle =
  | 'queued'           // created, not yet started into a lane
  | 'awaiting_gate'    // stage done but a human gate must approve before advancing
  | 'stage_running'    // a stage workflow is currently executing
  | 'stage_completed'  // a stage workflow finished successfully (terminal-lane case)
  | 'advancing'        // moving to the next lane after a successful stage
  | 'needs_attention'  // a stage failed (or a non-recoverable error) — no silent advance
  | 'done'             // reached a terminal lane successfully
  | 'cancelled';       // explicitly cancelled

/** Workflow engine statuses we map up into ticket lifecycle events. */
export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Allowed lifecycle transitions. A transition NOT present here is rejected by
 * {@link canTransitionTicket}. Terminal states ('done', 'cancelled') have no
 * outgoing transitions.
 */
export const VALID_TICKET_TRANSITIONS: Readonly<Record<TicketLifecycle, readonly TicketLifecycle[]>> = {
  queued:          ['stage_running', 'cancelled'],
  stage_running:   ['stage_completed', 'awaiting_gate', 'advancing', 'needs_attention', 'cancelled'],
  // After a successful stage we either advance (autonomous), wait for a gate,
  // or — when the stage was the terminal lane — mark the whole ticket done.
  stage_completed: ['advancing', 'awaiting_gate', 'done', 'cancelled'],
  awaiting_gate:   ['advancing', 'needs_attention', 'cancelled'],
  advancing:       ['stage_running', 'done', 'cancelled'],
  // Recovery: a retry re-runs the stage; a manual decision may still advance it.
  needs_attention: ['stage_running', 'advancing', 'cancelled'],
  done:            [],
  cancelled:       [],
};

/** True iff a ticket may move from `from` to `to`. */
export function canTransitionTicket(from: TicketLifecycle, to: TicketLifecycle): boolean {
  const allowed = VALID_TICKET_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/** The lifecycle a workflow status implies once a stage reports back. */
export type TicketEvent = {
  /** The next lifecycle the ticket should land in. */
  next: TicketLifecycle;
  /** Why — used for the swimlane_transitions audit reason. */
  reason: 'autonomous' | 'gate_approved' | 'failed' | 'retry' | 'manual' | 'pending';
  /** Whether the ticket is permitted to auto-advance off the back of this event. */
  canAutoAdvance: boolean;
};

/**
 * Map a workflow status to the ticket lifecycle event it triggers.
 *
 * INVARIANT: workflow 'completed' yields a success event whose `next` is
 * 'stage_completed' (the caller then decides advance vs. gate vs. done);
 * workflow 'failed' ALWAYS yields 'needs_attention' with canAutoAdvance=false.
 * There is no path where a 'failed' workflow advances the ticket.
 */
export function mapWorkflowStatusToTicketEvent(workflowStatus: WorkflowStatus): TicketEvent {
  switch (workflowStatus) {
    case 'completed':
      return { next: 'stage_completed', reason: 'autonomous', canAutoAdvance: true };
    case 'failed':
      // NEVER auto-advance on failure.
      return { next: 'needs_attention', reason: 'failed', canAutoAdvance: false };
    case 'cancelled':
      return { next: 'cancelled', reason: 'manual', canAutoAdvance: false };
    case 'running':
      return { next: 'stage_running', reason: 'pending', canAutoAdvance: false };
    case 'pending':
    default:
      return { next: 'stage_running', reason: 'pending', canAutoAdvance: false };
  }
}

/**
 * Resolve where a SUCCESSFUL stage should land the ticket, given board/lane
 * config. Encapsulates the gate-vs-advance-vs-done branch so both the
 * coordinator and tests share one rule.
 *
 * - terminal lane            → 'done'
 * - human gate (non-auto)    → 'awaiting_gate'
 * - autonomous + auto gate   → 'advancing'
 * - non-autonomous board     → 'awaiting_gate' (require explicit approval)
 */
export function resolveSuccessfulStageTarget(opts: {
  isTerminalLane: boolean;
  gate: string;            // 'auto' | 'human'
  boardAutonomous: boolean;
}): TicketLifecycle {
  if (opts.isTerminalLane) return 'done';
  if (opts.gate === 'human') return 'awaiting_gate';
  if (!opts.boardAutonomous) return 'awaiting_gate';
  return 'advancing';
}
