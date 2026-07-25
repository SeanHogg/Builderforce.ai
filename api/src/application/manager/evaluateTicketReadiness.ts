/**
 * evaluateTicketReadiness — the questions the AI Manager must ask before it completes
 * a ticket, and the action each answer implies.
 *
 * WHY THIS EXISTS
 * The manager's review handling used to ask exactly one question — "does this ticket
 * have a git branch and no PR yet?" — and if so it force-wrote `status = DONE` and
 * merged. Everything else it simply skipped in silence. The measured result: agents
 * moved 871 tickets into review, nobody ever evaluated one, no role ever signed off
 * (the sign-off ledger was empty tenant-wide), and 280 PRs sat open for up to 19 days.
 *
 * A ticket in review needs FOUR questions answered, and each has a different remedy:
 *
 *   1. Was this supposed to produce code, and did it?     → if not: send it BACK to be
 *      implemented. A `backend_api` ticket with no branch is not "done", it is unstarted,
 *      and leaving it in review is how work silently evaporates.
 *   2. Have all required roles signed off?                → if not: drive the sign-off.
 *   3. Does it build (compile / lint / tests) on its PR?  → if red: send it back.
 *                                                            If pending: wait, don't merge.
 *   4. Only when 1–3 pass                                 → complete + merge.
 *
 * The decision is a PURE function so every branch is unit-tested without a database or a
 * provider; {@link ReadinessAction} tells the caller what to DO, so the manager never
 * re-derives the policy inline.
 */
import { producerRoleForActionType } from '../kanban/roleCapability';
import type { SignoffGateResult } from '../kanban/signoffGate';

/** What the manager should do with a ticket sitting in review. */
export type ReadinessAction =
  /** Everything checks out — complete the ticket and merge/close it. */
  | 'complete'
  /** Required sign-offs are outstanding — dispatch the owing role(s) to review. */
  | 'drive_signoff'
  /** Expected a code deliverable and there is none — return it to implementation. */
  | 'return_to_implementation'
  /** The PR's build is failing — return it to implementation to fix. */
  | 'return_build_failed'
  /** The build has not reported yet — leave it; re-evaluate next pass. */
  | 'wait_for_build'
  /** A run is in flight — leave it alone. */
  | 'wait_for_run';

export interface ReadinessInput {
  /** 'task' | 'epic' | 'gap' | 'security' | 'incident' … */
  taskType: string | null;
  /** Learned/derived technical shape ('backend_api', 'frontend_ui', 'docs', …). */
  actionType: string | null;
  hasBranch: boolean;
  hasPr: boolean;
  /** Latest recorded build verdict for the ticket's PR. */
  buildStatus: 'success' | 'failure' | 'pending' | null;
  /** A pending/submitted/running/paused execution exists right now. */
  hasLiveRun: boolean;
  /** Result of the unanimous-sign-off gate. */
  signoff: SignoffGateResult;
  /** When false, sign-off is not required to complete (explicit opt-out). */
  requireSignoff: boolean;
  /** When true, a green build is required before merging (the `on_green` policy). */
  requireGreenBuild: boolean;
}

export interface TicketReadiness {
  action: ReadinessAction;
  /** True when this ticket's shape implies a code deliverable. */
  expectsCode: boolean;
  /** One plain sentence for the manager feed — why this action, in review terms. */
  detail: string;
}

/**
 * Does this ticket's shape imply a code deliverable?
 *
 * Reuses `producerRoleForActionType` rather than re-listing action types: if the work
 * maps to a PRODUCING role (developer / qa-tester / tech-writer / devops) then it is
 * meant to yield a branch. An `other`/unclassified ticket, and an Epic (which delegates
 * to children rather than producing directly), do not.
 */
export function expectsCodeDeliverable(taskType: string | null, actionType: string | null): boolean {
  if (taskType === 'epic') return false;
  return producerRoleForActionType(actionType) != null;
}

/**
 * Decide what to do with a ticket in review. PURE.
 *
 * Order matters and encodes the priority: never touch a live run; a missing deliverable
 * outranks a missing sign-off (there is nothing to review yet); a RED build outranks
 * sign-offs (approving broken code is worse than not approving it); a pending build
 * only delays the merge.
 */
export function decideTicketReadiness(input: ReadinessInput): TicketReadiness {
  const expectsCode = expectsCodeDeliverable(input.taskType, input.actionType);

  // 0. Something is actively working it — hands off.
  if (input.hasLiveRun) {
    return { action: 'wait_for_run', expectsCode, detail: 'A run is still in flight on this ticket.' };
  }

  // 1. Was it supposed to produce code, and did it? This is the check whose absence
  //    let implementable tickets rot in review with nothing to show.
  if (expectsCode && !input.hasBranch && !input.hasPr) {
    return {
      action: 'return_to_implementation',
      expectsCode,
      detail: `This is ${input.actionType ?? 'implementation'} work but it reached review with no branch or PR — returning it to implementation.`,
    };
  }

  // 2. Is the build red? Returning it beats approving broken work.
  if (input.hasPr && input.buildStatus === 'failure') {
    return {
      action: 'return_build_failed',
      expectsCode,
      detail: 'The pull request build is failing — returning it to implementation to fix.',
    };
  }

  // 3. Have all required roles signed off?
  if (input.requireSignoff && !input.signoff.satisfied) {
    return { action: 'drive_signoff', expectsCode, detail: input.signoff.detail };
  }

  // 4. Build must be green before a merge, when the project demands it.
  if (input.hasPr && input.requireGreenBuild && input.buildStatus !== 'success') {
    return {
      action: 'wait_for_build',
      expectsCode,
      detail: 'Waiting for a green build before merging.',
    };
  }

  return {
    action: 'complete',
    expectsCode,
    detail: input.requireSignoff
      ? `${input.signoff.detail} Build and deliverable checks passed — completing.`
      : 'Deliverable and build checks passed — completing.',
  };
}
