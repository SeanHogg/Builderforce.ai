/**
 * stallTriage — the AI Manager's diagnosis of a ticket that has STOPPED MOVING, and
 * the remedy that specific stall calls for.
 *
 * WHY THIS EXISTS
 * The manager pass grooms value, ranks, assigns, opens/merges PRs and audits role
 * coverage — every one of those acts on a ticket the manager happens to LOOK at this
 * pass. None of them asks the question a human PM asks first: *what is stuck, and
 * why?* The measured consequence on tenant 1 (821 tickets, 90 days): 809 stalled,
 * 466 of them inert from birth — never dispatched, never audited, never escalated.
 * Nothing in the system was accountable for noticing.
 *
 * This module is that accountability, and it is deliberately built as TWO pure steps:
 *
 *   1. {@link diagnoseStall}          — what is wrong, and what would fix it.
 *   2. {@link escalateIfIneffective}  — has the manager already tried that fix, and
 *                                       did it work?
 *
 * STEP 2 IS THE POINT. The merge livelock this work uncovered (40,580 `sync_pr`
 * actions against 10 actual merges) was not a bad remedy — syncing a stale branch is
 * correct. It was a remedy applied forever with nothing ever checking whether it
 * MOVED anything. A manager that re-dispatches an unassigned ticket every five
 * minutes for nineteen days is not autonomous, it is a retry storm with a job title.
 * So every remedy here is tracked (see `stallWatch.ts`), and a remedy that has been
 * applied {@link MAX_REMEDY_ATTEMPTS} times without the ticket moving converts to
 * `escalate_human` — the manager states plainly that its own fix is not working
 * rather than looping on it.
 *
 * The diagnosis REUSES the existing verdicts rather than re-deriving them:
 *   • `AutoRunReason`  (evaluateAutoRun) — the canonical "why isn't this dispatching"
 *   • `ReadinessAction` (evaluateTicketReadiness) — the in-review question set
 * so there is exactly one place in the codebase that decides each of those, and this
 * module only decides what to DO about the answer.
 */
import type { AutoRunReason } from '../swimlane/evaluateAutoRun';
import type { ReadinessAction } from './evaluateTicketReadiness';

/** How long a ticket may sit without a status change before it counts as stalled. */
export const STALL_AFTER_MS = 24 * 60 * 60_000;

/**
 * How many times the manager may apply the SAME remedy to the SAME ticket before it
 * concedes the remedy is not working and escalates to a human.
 *
 * Three is deliberate: one attempt can lose to a transient (a token cap, a provider
 * blip), two can lose to a slow-clearing one, but a remedy that has failed to move a
 * ticket three separate passes is not going to on the fourth. This is the ceiling
 * whose absence produced the 4058:1 sync-to-merge ratio.
 */
export const MAX_REMEDY_ATTEMPTS = 3;

/** Why a ticket is not moving. */
export type StallCause =
  /** Not stalled — a run is in flight right now. */
  | 'live'
  /** Not stalled — the ticket is inside its post-failure back-off window. */
  | 'cooling_down'
  /** Not stalled — it changed status recently enough to still be in motion. */
  | 'moving'
  /** Created and never executed even once; nothing has ever tried to do the work. */
  | 'never_started'
  /** No agent (lane staffing or owner) can run it. */
  | 'unassigned'
  /** Candidate agents exist but none holds the lane's required capabilities. */
  | 'capability_gap'
  /** The lane gate is 'human' — autonomy is waiting on an approval nobody gave. */
  | 'human_gate'
  /** Consecutive failures tripped the auto-run circuit breaker. */
  | 'failure_breaker'
  /** In review, was meant to produce code, and produced none. */
  | 'missing_deliverable'
  /** Its PR build is red. */
  | 'build_failed'
  /** Required roles have not signed off. */
  | 'awaiting_signoff'
  /** The PR cannot merge — the branch conflicts with its base. */
  | 'pr_conflict'
  /** Our row says the PR is open but the provider says otherwise (state drift). */
  | 'pr_unreconciled'
  /** Ready to merge, but the effective policy withholds merge authority. */
  | 'merge_withheld'
  /** Explicitly blocked (a dependency or an external waiting-on). */
  | 'blocked'
  /** Stalled for a reason this taxonomy cannot name — surfaced, never swallowed. */
  | 'unknown';

/**
 * What the manager should DO. Every value except `none`/`escalate_human` maps to an
 * action the manager can already perform in its pass — the taxonomy deliberately
 * contains no remedy the manager cannot execute.
 */
export type StallRemedy =
  /** Nothing to do — the ticket is not stalled. */
  | 'none'
  /** Staff it: pick an owner (or lane agent) so something can run it. */
  | 'assign'
  /** It is runnable and nothing started it — start it. */
  | 'dispatch'
  /** Rewind to the earliest unmet stage and staff the missing role. */
  | 'coordinate'
  /** Send it back to be implemented — it reached review with no deliverable. */
  | 'return_to_implementation'
  /** Ask the owing role(s) to record their sign-off. */
  | 'drive_signoff'
  /** Clear the failure breaker and allow one fresh attempt. */
  | 'reset_breaker'
  /** Re-read the PR from the provider and correct our stored state. */
  | 'reconcile_pr'
  /** Dispatch an agent to rebase/resolve the conflicting branch. */
  | 'resolve_conflict'
  /** The manager cannot fix this one — say so, loudly and once. */
  | 'escalate_human';

export interface StallDiagnosis {
  stalled: boolean;
  cause: StallCause;
  remedy: StallRemedy;
  /** One plain sentence for the manager feed and the stuck register. */
  detail: string;
  /** True once the manager has conceded its own remedy is not working. */
  escalated: boolean;
}

export interface StallInput {
  status: string;
  /** Terminal (Done/cancelled) tickets are never stalled. */
  isTerminal: boolean;
  /** Milliseconds since the last status change — or since creation if it never moved. */
  idleMs: number;
  /** False when the ticket has never had a single execution. */
  everRan: boolean;
  /** The canonical dispatch verdict — see {@link AutoRunReason}. */
  autoRunReason: AutoRunReason;
  /** A live (pending/submitted/running/paused) execution exists right now. */
  hasLiveRun: boolean;
  /**
   * The in-review question set's answer, when the ticket is in review. Null for a
   * ticket that is not in review (the readiness questions do not apply to backlog).
   */
  readiness: ReadinessAction | null;
  /**
   * Whether ANY outstanding required sign-off is owed by an agent the manager can
   * dispatch. Null when the question does not apply (no gate evaluated).
   *
   * Load-bearing: `drive_signoff` is only a remedy the manager can perform when there
   * is an agent to ask. On a ticket whose outstanding roles are unstaffed or owed by a
   * person, "asking the owing roles to review" is a no-op that was re-diagnosed every
   * five minutes and never counted as an attempt — so it never reached the escalation
   * ceiling either. Measured: register rows sitting 24+ days at attempts=0. When this
   * is false the diagnosis hands the ticket to a human immediately, which is the true
   * answer rather than a remedy that cannot run.
   */
  signoffDispatchable?: boolean | null;
  /**
   * The CURRENT STAGE's outstanding required roles, for a ticket that is NOT in review.
   *
   * The hole this closes: the lane requirement gate asks each role exactly once per stage
   * (the slot's `in_progress` marker is the record that it asked) and delegates re-asking
   * to the manager. But the manager could only drive sign-offs for `in_review` tickets —
   * `readiness` above is null on every other lane — so a stage whose one ask was refused,
   * or whose reviewer finished without recording a verdict, had NO retry owner at all. It
   * then fell through to `unknown → coordinate`, which re-runs the very gate that will not
   * re-ask. Measured: an epic at stage 3 of 7 with 10 required slots and 0 sign-offs.
   *
   * Null when the question does not apply (in-review tickets use `readiness`, which
   * carries the whole-ticket gate).
   */
  stageSignoff?: { roleNames: string[]; dispatchable: boolean } | null;
  /** PR state, when the ticket has one. */
  pr: {
    /** Our stored row says it is open. */
    open: boolean;
    /** The provider says it is NOT open — our row is stale (state drift). */
    providerClosed: boolean;
    /** The branch conflicts with its base and cannot merge. */
    conflicted: boolean;
  } | null;
  /** The PR is mergeable and signed off, but policy withholds merge authority. */
  mergeWithheld: boolean;
  /** How long the ticket may idle before counting as stalled. Defaults to {@link STALL_AFTER_MS}. */
  stallAfterMs?: number;
}

const NOT_STALLED = (cause: StallCause, detail: string): StallDiagnosis =>
  ({ stalled: false, cause, remedy: 'none', detail, escalated: false });

/**
 * Diagnose one ticket. PURE.
 *
 * Order encodes priority, and the first three checks are all NEGATIVE — a ticket that
 * is genuinely in motion must never be "remediated", because acting on a live ticket
 * is how a manager creates the duplicate runs and lane thrash it is supposed to
 * prevent. Only past those does it ask what is wrong.
 *
 * Within the stalled branch, provider TRUTH outranks our stored state (a PR the
 * provider already closed is not a merge problem, it is a bookkeeping problem), a
 * missing deliverable outranks a missing sign-off (there is nothing to review yet),
 * and a red build outranks a sign-off (approving broken work is worse than not
 * approving it) — the same precedence `decideTicketReadiness` uses, deliberately, so
 * the two never contradict each other on the same ticket.
 */
export function diagnoseStall(input: StallInput): StallDiagnosis {
  const stallAfter = input.stallAfterMs ?? STALL_AFTER_MS;

  // ── Not stalled ───────────────────────────────────────────────────────────
  if (input.isTerminal) return NOT_STALLED('moving', 'This ticket is finished.');
  if (input.hasLiveRun || input.autoRunReason === 'already_running') {
    return NOT_STALLED('live', 'A run is in flight on this ticket.');
  }
  if (input.autoRunReason === 'cooldown_active') {
    return NOT_STALLED('cooling_down', 'Backing off after a failed run — it retries on its own.');
  }
  // A ticket that is about to be dispatched by the normal path is not stuck; leave it
  // to the dispatcher rather than racing it.
  if (input.autoRunReason === 'will_run' && input.idleMs < stallAfter) {
    return NOT_STALLED('moving', 'Queued to run on the next dispatch.');
  }
  if (input.idleMs < stallAfter) {
    return NOT_STALLED('moving', 'Changed status recently — still in motion.');
  }

  const idleDays = Math.floor(input.idleMs / 86_400_000);
  const age = idleDays >= 1 ? `${idleDays} day${idleDays === 1 ? '' : 's'}` : 'over a day';
  const stalled = (cause: StallCause, remedy: StallRemedy, detail: string): StallDiagnosis =>
    ({ stalled: true, cause, remedy, detail, escalated: false });

  // ── Bookkeeping drift beats every other reading of the PR ──────────────────
  if (input.pr?.open && input.pr.providerClosed) {
    return stalled(
      'pr_unreconciled', 'reconcile_pr',
      `Stuck ${age}: this pull request is recorded as open but the provider says it is not — correcting our record.`,
    );
  }

  // ── Dispatch-side stalls (nothing is working the ticket) ──────────────────
  switch (input.autoRunReason) {
    case 'no_agent':
      return stalled(
        'unassigned', 'assign',
        `Stuck ${age}: no agent is staffed on this lane and the ticket has no owner, so nothing can run it — staffing it.`,
      );
    case 'capability_mismatch':
      return stalled(
        'capability_gap', 'escalate_human',
        `Stuck ${age}: every available agent lacks the capabilities this lane requires — a human must staff a capable agent.`,
      );
    case 'run_cap_exhausted':
      return stalled(
        'failure_breaker', 'reset_breaker',
        `Stuck ${age}: consecutive failed runs tripped the safety breaker — allowing one fresh attempt.`,
      );
    case 'human_gate':
      // A human-gated lane is stalled only because nobody approved it. That is a
      // legitimate configuration, so the manager escalates rather than overriding a
      // gate a human deliberately set.
      return stalled(
        'human_gate', 'escalate_human',
        `Stuck ${age}: this lane requires human approval and none has been given.`,
      );
    case 'pending_approval':
      return stalled(
        'human_gate', 'escalate_human',
        `Stuck ${age}: this arrived as external feedback and needs a human to accept it in triage.`,
      );
    case 'no_board':
    case 'no_lane':
      return stalled(
        'unknown', 'escalate_human',
        `Stuck ${age}: the ticket's status matches no lane on the board, so autonomy cannot place it.`,
      );
    case 'not_executable':
    case 'terminal_lane':
      return NOT_STALLED('moving', 'This ticket is not agent-executable by design.');
    default:
      break;
  }

  // ── Review-side stalls (work was produced; the review loop stopped) ────────
  if (input.readiness) {
    switch (input.readiness) {
      case 'return_to_implementation':
        return stalled(
          'missing_deliverable', 'return_to_implementation',
          `Stuck ${age} in review with no branch or pull request — returning it to implementation.`,
        );
      case 'return_build_failed':
        return stalled(
          'build_failed', 'return_to_implementation',
          `Stuck ${age}: the pull request build is failing — returning it to implementation to fix.`,
        );
      case 'drive_signoff':
        // Only a remedy when there is an agent to ask; otherwise a person owes it.
        return input.signoffDispatchable === false
          ? {
            stalled: true,
            cause: 'awaiting_signoff',
            remedy: 'escalate_human',
            detail: `Stuck ${age} waiting on required sign-offs that no agent can give — the owing roles are unstaffed or held by a person, so a human must sign off or staff them.`,
            escalated: true,
          }
          : stalled(
            'awaiting_signoff', 'drive_signoff',
            `Stuck ${age} waiting on required sign-offs — asking the owing roles to review.`,
          );
      case 'wait_for_build':
        return stalled(
          'build_failed', 'escalate_human',
          `Stuck ${age}: no build verdict has arrived for this pull request, so the merge cannot be cleared.`,
        );
      case 'complete':
        break;
      case 'wait_for_run':
        return NOT_STALLED('live', 'A run is in flight on this ticket.');
    }
  }

  if (input.pr?.conflicted) {
    return stalled(
      'pr_conflict', 'resolve_conflict',
      `Stuck ${age}: the pull request conflicts with its base branch — dispatching an agent to resolve it.`,
    );
  }
  if (input.mergeWithheld) {
    return stalled(
      'merge_withheld', 'escalate_human',
      `Stuck ${age}: this is ready to merge but the manager is not permitted to merge on this project.`,
    );
  }
  if (input.status === 'blocked') {
    return stalled(
      'blocked', 'escalate_human',
      `Stuck ${age} in a blocked state — a human needs to clear what it is waiting on.`,
    );
  }
  // Never executed and no dispatch reason explains it — the inert-from-birth case.
  if (!input.everRan) {
    return stalled(
      'never_started', 'dispatch',
      `Stuck ${age}: created but never run even once — starting it.`,
    );
  }
  // ── This stage's roles owe work, on ANY lane ──────────────────────────────
  // Placed after every stronger diagnosis (conflicted PR, red build, blocked, a ticket
  // that never ran once) but BEFORE the `will_run → dispatch` fall-through, which is the
  // ordering the measured failure turns on: the evaluator does not model the lane
  // requirement gate, so it answers `will_run` for a ticket the gate then declines. That
  // made `dispatch` the diagnosis for a ticket whose only real blocker was an owed role,
  // and re-dispatching it just re-runs the gate that has ALREADY asked this stage and
  // will not ask again (the slot's `in_progress` marker is exactly what stops it). The
  // remedy applied nothing, `attempts` stayed at zero, and the escalation ceiling that
  // hands the ticket to a human was unreachable. Asking the owed role is the action that
  // can actually move it.
  if (input.stageSignoff && input.stageSignoff.roleNames.length > 0) {
    const roles = input.stageSignoff.roleNames.join(', ');
    return input.stageSignoff.dispatchable
      ? stalled(
        'awaiting_signoff', 'drive_signoff',
        `Stuck ${age}: this stage's required role${input.stageSignoff.roleNames.length === 1 ? '' : 's'} (${roles}) never recorded their work — asking again.`,
      )
      : {
        stalled: true,
        cause: 'awaiting_signoff',
        remedy: 'escalate_human',
        detail: `Stuck ${age}: this stage needs ${roles}, and no agent can be asked — the role is unstaffed or held by a person.`,
        escalated: true,
      };
  }

  if (input.autoRunReason === 'will_run') {
    return stalled(
      'never_started', 'dispatch',
      `Stuck ${age} despite being runnable — nothing dispatched it, so the manager is starting it.`,
    );
  }

  return stalled(
    'unknown', 'coordinate',
    `Stuck ${age} with no recognised blocker — re-coordinating the ticket to find the unmet step.`,
  );
}

/**
 * Build {@link StallInput.stageSignoff} from a stage-scoped gate. PURE.
 *
 * Lives here rather than inline in the triage loop so the rule that decides whether a
 * ticket is "waiting on this stage's roles" is testable without a database — it is the
 * input that turns a useless `coordinate` into an actionable ask, and getting its null
 * cases wrong either escalates a healthy ticket or hides a stuck one.
 *
 * Null for an IN-REVIEW ticket: there `readiness` already carries the whole-ticket gate
 * and owns the diagnosis, so answering twice would let the weaker branch win.
 */
export function stageSignoffFor(
  status: string,
  gate: { outstanding: readonly { roleName: string }[] } | null,
  ownership: { dispatchable: readonly unknown[] } | null,
  inReviewStatus: string,
): StallInput['stageSignoff'] {
  if (status === inReviewStatus || !gate || !ownership) return null;
  return {
    roleNames: [...new Set(gate.outstanding.map((o) => o.roleName))],
    dispatchable: ownership.dispatchable.length > 0,
  };
}

/**
 * Convert a remedy the manager has already tried and tried into an escalation. PURE.
 *
 * `priorAttempts` is how many times THIS remedy has been applied to THIS ticket
 * without it moving (see `stallWatch.ts`, which resets the counter the moment the
 * ticket changes status). At the ceiling the diagnosis keeps its cause — the
 * diagnosis was never the problem — but its remedy becomes `escalate_human` and the
 * detail says what was tried and how often, so the human inherits the history rather
 * than a bare "stuck".
 *
 * A diagnosis that is already `escalate_human` is returned unchanged: escalating an
 * escalation is not a state.
 */
export function escalateIfIneffective(
  diagnosis: StallDiagnosis,
  priorAttempts: number,
  maxAttempts: number = MAX_REMEDY_ATTEMPTS,
): StallDiagnosis {
  if (!diagnosis.stalled) return diagnosis;
  if (diagnosis.remedy === 'escalate_human') return { ...diagnosis, escalated: true };
  if (priorAttempts < maxAttempts) return diagnosis;
  return {
    ...diagnosis,
    remedy: 'escalate_human',
    escalated: true,
    detail:
      `${diagnosis.detail} The manager has already applied this fix ${priorAttempts} times ` +
      `without the ticket moving, so it needs a human.`,
  };
}

/** Human-readable label per cause — one source for the feed, the register and the UI. */
export const STALL_CAUSE_LABEL: Record<StallCause, string> = {
  live: 'Running',
  cooling_down: 'Backing off',
  moving: 'In motion',
  never_started: 'Never started',
  unassigned: 'Nobody assigned',
  capability_gap: 'No capable agent',
  human_gate: 'Awaiting human approval',
  failure_breaker: 'Halted after repeated failures',
  missing_deliverable: 'No deliverable produced',
  build_failed: 'Build not green',
  awaiting_signoff: 'Awaiting sign-off',
  pr_conflict: 'Pull request conflicts',
  pr_unreconciled: 'Pull request state drifted',
  merge_withheld: 'Merge withheld by policy',
  blocked: 'Blocked',
  unknown: 'Unclassified',
};

/** True when the remedy is something the manager performs itself (vs. hands over). */
export function isManagerActionable(remedy: StallRemedy): boolean {
  return remedy !== 'none' && remedy !== 'escalate_human';
}
