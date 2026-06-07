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

/** The lane action that fires once a stage succeeds (migration 0084). */
export type StageActionType = 'advance' | 'move_ticket' | 'run_workflow';

/** What a successful stage should do: the lifecycle + any action side-effect. */
export interface StageActionPlan {
  /** Where the ticket lands: advancing | awaiting_gate | done. */
  lifecycle: TicketLifecycle;
  /** For 'move_ticket': the destination lane key (instead of the next lane). */
  moveToLaneKey?: string | null;
  /** For 'run_workflow': the workflow definition id to instantiate as a side-effect. */
  runWorkflowId?: string | null;
}

/**
 * Resolve what a SUCCESSFUL stage should do, given the lane config. Autonomy is
 * now IMPLICIT — there is no board-level toggle: a successful stage advances
 * unless its lane gate is 'human' (then it waits for approval). The lane's
 * action decides WHERE it advances.
 *
 * - human gate         → 'awaiting_gate' (gate wins over any action)
 * - terminal lane      → 'done'
 * - action move_ticket → 'advancing' to actionTarget (a lane key)
 * - action run_workflow→ 'advancing' to the next lane, plus run actionTarget
 * - else / 'advance'   → 'advancing' to the next lane (legacy default)
 */
export function resolveStageAction(opts: {
  isTerminalLane: boolean;
  gate: string;                  // 'auto' | 'human'
  actionType: string | null;     // null|'advance' | 'move_ticket' | 'run_workflow'
  actionTarget: string | null;
}): StageActionPlan {
  // A human gate pauses everything — no action fires until approval.
  if (opts.gate === 'human') return { lifecycle: 'awaiting_gate' };
  // move_ticket redirects where the ticket lands (overrides terminal/next-lane).
  if (opts.actionType === 'move_ticket') {
    return { lifecycle: 'advancing', moveToLaneKey: opts.actionTarget };
  }
  // run_workflow fires as a side-effect wherever the ticket lands (advance or done).
  const runWorkflowId = opts.actionType === 'run_workflow' ? opts.actionTarget : null;
  if (opts.isTerminalLane) return { lifecycle: 'done', runWorkflowId };
  return { lifecycle: 'advancing', runWorkflowId };
}
