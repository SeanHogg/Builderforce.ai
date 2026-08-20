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
 *   4. Is there still an open pull request to land?       → if so: it is not done. The
 *      merge stage owns it.
 *   5. Only when 1–4 pass                                 → complete, and open a PR if the
 *      branch never got one.
 *
 * ── QUESTION 4 IS WHY THE RETIRED-PR PILE GROWS (api 2026.7.195) ─────────────────
 * Measured on project 11, one pass, 78ms apart:
 *
 *   09:00:04.193  ticket -085  "Deliverable and build checks passed — completing.
 *                               Closed …  (no branch to merge)."   {"openedPr":false}
 *   09:00:04.271  the merge stage retires that same ticket's PR #103, conflict_exhausted
 *
 * The ticket had a branch AND an open pull request. "No branch to merge" was simply false:
 * the completion branch asked `hasBranch && !hasPr` to decide whether to OPEN a PR and
 * then completed either way, conflating "there is nothing to merge" with "there is
 * already a pull request". Every ticket that took that path became a done ticket with an
 * unmerged branch behind it — the human-owed PR pile went 49 → 52 → 72 → 75 in two days,
 * with 5 of its top 10 rows flagged "ticket already DONE — close this PR".
 *
 * A ticket is done when there is nothing left to land, so an open PR now yields
 * {@link ReadinessAction} `await_merge` and the merge stage — the stage immediately below
 * this one in the same pass — decides its fate. And when a ticket DOES complete,
 * {@link CompletionShape} says which of the four closures actually applied, so the
 * journalled sentence can no longer claim one that did not.
 *
 * The decision is a PURE function so every branch is unit-tested without a database or a
 * provider; {@link ReadinessAction} tells the caller what to DO, so the manager never
 * re-derives the policy inline.
 */
import { producerRoleForActionType } from '../kanban/roleCapability';
import type { SignoffGateResult } from '../kanban/signoffGate';
import type { DeliverableEvidence } from '../delivery/deliverableEvidence';

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
  | 'wait_for_run'
  /** An open pull request still has to land — the merge stage owns it, not completion. */
  | 'await_merge';

/** What the ticket's recorded pull request is doing right now. */
export type TicketPrState =
  /** No pull request has ever been recorded for this ticket. */
  | 'none'
  /** One is OPEN and unmerged — something still has to land it before the ticket is done. */
  | 'open'
  /** One exists and is no longer open (merged, or closed) — nothing left to land. */
  | 'settled';

/**
 * How a completing ticket is closed out — set only when `action === 'complete'`.
 *
 * It exists so the caller does not re-derive the completion policy inline: the four
 * closures are genuinely different sentences, and the one that used to be printed for all
 * of them ("no branch to merge") was false for three.
 */
export type CompletionShape =
  /** A branch exists, no PR was ever opened, and there is an agent to open one. */
  | 'open_pr'
  /** Nothing was ever produced — there is genuinely nothing to merge. */
  | 'no_deliverable'
  /** Its pull request already settled (merged, or closed) — nothing left to land. */
  | 'pr_settled'
  /** A branch exists with no PR and nobody to open one, so it closes unmerged. */
  | 'branch_unopened';

export interface ReadinessInput {
  /** 'task' | 'epic' | 'gap' | 'security' | 'incident' … */
  taskType: string | null;
  /** Learned/derived technical shape ('backend_api', 'frontend_ui', 'docs', …). */
  actionType: string | null;
  hasBranch: boolean;
  /** Whether a pull request exists and whether it still has to land — see {@link TicketPrState}. */
  prState: TicketPrState;
  /** An agent is attached, so the manager has somebody to open the PR as. */
  hasAssignee: boolean;
  /** Latest recorded build verdict for the ticket's PR. */
  buildStatus: 'success' | 'failure' | 'pending' | null;
  /** A pending/submitted/running/paused execution exists right now. */
  hasLiveRun: boolean;
  /** Recorded file evidence for this ticket. `unknown` never fails closed by itself. */
  deliverableEvidence: DeliverableEvidence;
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
  /** Which closure applies — non-null only when `action === 'complete'`. */
  completion: CompletionShape | null;
}

/**
 * TICKET KINDS whose deliverable is never a branch.
 *
 * `epic` delegates to children rather than producing directly. `product` is a scope
 * brief a Product-Manager agent authors, and `design` is a UI/UX design or design review
 * (both migration 0293, both publishable to the Gig Marketplace) — their deliverable is
 * the document or the design, and neither can ever satisfy a "where is the branch?"
 * check. Their absence from this set is what let the CONDUCT pass return a finished
 * design brief to implementation, whereupon it re-ran, reached review with the same
 * (correct) deliverable, and was returned again — bounded only by stall triage's
 * 3-attempt escalation.
 */
const NON_CODE_TASK_TYPES: ReadonlySet<string> = new Set(['epic', 'product', 'design']);

/**
 * ACTION TYPES that are explicitly not code work.
 *
 * `docs` is the explicit non-code classification: its intended deliverable is the
 * document itself, unlike a coding ticket that happens to have produced only a PRD.
 * `analysis` / `provisioning` / `decision` are the spec-shaped remainder of
 * {@link ACTION_TYPES}. Anything not listed here still has to MAP to a producing role
 * below, so `other` and an unset action type are non-code by construction.
 */
const NON_CODE_ACTION_TYPES: ReadonlySet<string> = new Set(['docs', 'analysis', 'provisioning', 'decision']);

/**
 * Does this ticket's shape imply a code deliverable?
 *
 * Reuses `producerRoleForActionType` rather than re-listing action types: if the work
 * maps to a PRODUCING role (developer / qa-tester / tech-writer / devops) then it is
 * meant to yield a branch. An `other`/unclassified ticket does not, and neither does a
 * ticket whose KIND is non-code (see {@link NON_CODE_TASK_TYPES}).
 *
 * BOTH axes are consulted, and that is the point. The classification used to be
 * action-type-first with `epic` as the only task-type exception, so a spec-shaped ticket
 * carrying a coding action type (the common shape for a `product`/`design` brief, which
 * inherits its action type from the work it describes) was judged code-bearing and
 * bounced out of review with nothing to fix. The ticket KIND is the stronger signal
 * about what the deliverable IS, so it decides first.
 */
export function expectsCodeDeliverable(taskType: string | null, actionType: string | null): boolean {
  if (taskType && NON_CODE_TASK_TYPES.has(taskType)) return false;
  if (actionType && NON_CODE_ACTION_TYPES.has(actionType)) return false;
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
  const hasPr = input.prState !== 'none';
  const at = (action: ReadinessAction, detail: string): TicketReadiness =>
    ({ action, expectsCode, detail, completion: null });

  // 0. Something is actively working it — hands off.
  if (input.hasLiveRun) return at('wait_for_run', 'A run is still in flight on this ticket.');

  // 1. Was it supposed to produce code, and did it? This is the check whose absence
  //    let implementable tickets rot in review with nothing to show.
  if (expectsCode && (input.deliverableEvidence === 'none' || input.deliverableEvidence === 'docs_only'
    || (!input.hasBranch && !hasPr))) {
    const produced = input.deliverableEvidence === 'docs_only'
      ? 'only documentation'
      : 'no implementation files';
    return at(
      'return_to_implementation',
      `This is ${input.actionType ?? 'implementation'} work but it reached review with ${produced} — returning it to implementation.`,
    );
  }

  // 2. Is the build red? Returning it beats approving broken work.
  if (hasPr && input.buildStatus === 'failure') {
    return at('return_build_failed', 'The pull request build is failing — returning it to implementation to fix.');
  }

  // 3. Have all required roles signed off?
  if (input.requireSignoff && !input.signoff.satisfied) {
    return at('drive_signoff', input.signoff.detail);
  }

  // 4. Build must be green before a merge, when the project demands it.
  if (hasPr && input.requireGreenBuild && input.buildStatus !== 'success') {
    return at('wait_for_build', 'Waiting for a green build before merging.');
  }

  // 5. IS THERE STILL SOMETHING TO LAND? Every check above this one asks whether the work
  //    is GOOD; this asks whether it is IN. A ticket whose pull request is still open is
  //    not finished — it is waiting on a merge — and completing it here is what produced a
  //    done ticket sitting in front of an unmerged branch 78ms before the merge stage
  //    retired that same branch to a human (see the header). The merge stage below owns
  //    the outcome: it merges the PR (which completes the ticket through the shared
  //    `completeTaskOnMerge` path), or it retires it to a person and says so. Deliberately
  //    NOT journalled per pass — that stage is the single writer for a PR's fate, and a
  //    second row per review ticket per pass is the duplicate-decision problem one stage
  //    over.
  if (input.prState === 'open') {
    return at(
      'await_merge',
      'Its pull request is still open, so the work has not landed yet — completion waits on the merge queue, which either lands it or hands it to a person.',
    );
  }

  const completion: CompletionShape = input.hasBranch && !hasPr
    ? (input.hasAssignee ? 'open_pr' : 'branch_unopened')
    : hasPr ? 'pr_settled' : 'no_deliverable';
  return {
    action: 'complete',
    expectsCode,
    completion,
    detail: input.requireSignoff
      ? `${input.signoff.detail} Build and deliverable checks passed — completing.`
      : 'Deliverable and build checks passed — completing.',
  };
}
