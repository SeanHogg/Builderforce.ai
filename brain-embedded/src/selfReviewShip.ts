/**
 * SELF-REVIEW SHIP — in a local editor session the agent is the reviewer of its own
 * change, so it reviews, commits, pushes, and the ticket closes.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `tickets.from_delta` opens every editor change's ticket in `in_review` (75% on the
 * board): "the code exists but has not landed". Something then has to review it and
 * land it. On the web and in the cloud that is a pull request, a reviewer agent, a merge
 * webhook. In the VS Code extension it is NOBODY: the run is local, it holds the only
 * copy of the change, and no other agent can reach the user's working tree. The persona
 * nevertheless told the agent the "default route is review" (ticket branch + pull
 * request) and to push the base branch only when the human explicitly asked — so the
 * agent edited, recorded the delta, stopped, and the ticket sat at 75% indefinitely
 * (measured, chat #103: two "Code change … from Brain chat" tickets parked in review,
 * the edits uncommitted on disk).
 *
 * The fix is to say what is true on this surface: the agent IS the reviewer. It
 * verifies, reviews its own diff, records that review on the ticket, then commits and
 * pushes the base branch — each publish call still surfaces the host's approval prompt,
 * which is the human's review of the agent's review. The verified push is what the
 * existing `shippedToBaseBranch` → `completeShippedTickets` backstop needs to move the
 * ticket to done.
 *
 * Two halves, one module, so they cannot disagree:
 *   - {@link selfReviewShipDirective} — the system-prompt contract.
 *   - {@link leftChangeUnshipped} + {@link unshippedChangeNudge} — the loop gate that
 *     re-prompts a turn that changed code and ended without even TRYING to ship it.
 *     (Enforcement lives in the loop, not only in advice: a directive a model can skim
 *     past is exactly how the 75% tickets happened.)
 *
 * Gated on {@link canShipHere} — the host advertised the git publish tools — so the web
 * Brain (no working tree, no git) never sees any of it.
 *
 * Framework-free (strings, Sets, predicates) so it is safe in every bundle.
 */

import { asksForChange } from '@builderforce/agent-stall';
import type { BrainTraceEvent } from './brainTriage';
import { canShipHere } from './localWorkspaceTools';
import { commandOf, gitCommandPattern } from './shipVerification';

/**
 * The directive. Uses the names the model actually sees: plain names for the local git
 * tools, `builtin_*` for the platform ones (which also pins those into the advertised
 * set — the loop pins every `builtin_*` name the system prompt mentions).
 */
export function selfReviewShipDirective(chatId: number): string {
  return (
    'SHIP YOUR OWN CHANGE — in this session YOU are its reviewer. This is a local editor session: no other agent or reviewer can ever reach a change you leave in the working tree, so a ticket you leave "in_review" sits at 75% on the board forever. When your turn changes code, finish it in this order:\n' +
    '1. VERIFY — run the type-check / tests / build that cover what you touched (`run_command`) and fix whatever fails.\n' +
    '2. SELF-REVIEW — read your own diff with `git_diff` against what the ticket and the user asked for: bugs, leftover debug code, edits unrelated to the task, missing tests or localisation. If you find a problem, FIX it and review again. Then record the pass with builtin_reviews_record (taskId = the ticket tracking this change — builtin_chats_list_tickets with chatId=' + chatId + ' lists it; verdict "complete"; a one-paragraph summary of what you checked).\n' +
    '3. SHIP — `git_commit` with allowBaseBranch:true and exactly the `paths` you changed (never a catch-all: the tree may hold the human\'s own work), then `git_push` with allowBaseBranch:true. Both are shown to the human for approval — that approval is their review of your review, so do not ask for it in prose as well.\n' +
    '4. CLOSE — the push reports the branch it landed on. Once it lands on the base branch with nothing left to push, the in_review ticket this chat opened for the change moves to done automatically. Move any OTHER linked ticket this change fully delivers to done yourself with builtin_tasks_update. Report the commit hash and the push result.\n' +
    'Exceptions, and only these: if the user asked for a pull request or a ticket branch, commit on a `branch` and `open_pull_request` instead (the ticket then closes when that PR merges); if the user said not to commit or push, leave the change uncommitted and say so. If a commit or push is refused or fails, report the exact error — never claim a change shipped when it did not.'
  );
}

/** The local publish tools. Calling any of them — successfully or not — is an attempt. */
const PUBLISH_TOOLS: ReadonlySet<string> = new Set(['git_commit', 'git_push', 'open_pull_request']);

/** A raw `git commit` / `git push` through the shell is an attempt too. */
const RAW_PUBLISH = gitCommandPattern('commit|push');

/**
 * Did this run TRY to publish its work?
 *
 * Success is deliberately not required. A commit the human declined at the approval
 * prompt, or a push the remote rejected, is a result the model has to REPORT — and
 * re-prompting it to ship would re-ask a person who already said no.
 */
export function attemptedPublish(events: readonly BrainTraceEvent[]): boolean {
  return events.some(
    (e) => e.category === 'tool' && (PUBLISH_TOOLS.has(e.label) || RAW_PUBLISH.test(commandOf(e))),
  );
}

/**
 * The user told the agent NOT to publish. Narrow on purpose: only an explicit negation
 * of committing / pushing / shipping, or an instruction to keep the change local. A
 * request that merely does not MENTION committing is not a refusal — on this surface the
 * agent is the reviewer, and shipping is the end of the job.
 */
const DECLINES_SHIPPING =
  /\b(?:don'?t|do not|never|without)\s+(?:commit|push|ship|merg)\w*|\b(?:no|skip)\s+(?:commit|push)\w*|\b(?:leave|keep)\s+(?:it|them|this|the\s+(?:change|changes|edits?))\s+(?:uncommitted|unstaged|local(?:ly)?)\b/i;

export function declinesShipping(text: string | null | undefined): boolean {
  return DECLINES_SHIPPING.test(text ?? '');
}

/** What the loop knows when a turn ends without tool calls. */
export interface UnshippedChangeInput {
  /** A workspace code-change tool succeeded in THIS run. */
  codeChanged: boolean;
  /** Names of the tools this run's host advertised. */
  toolNames: readonly string[];
  /** The user's own request for this run — never a nudge the loop injected. */
  requestText: string | null | undefined;
  /** THIS run's trace events (not an earlier run's — see `brainRunStore.runTrace`). */
  events: readonly BrainTraceEvent[];
}

/**
 * Is this turn ending with a code change the agent never attempted to ship?
 *
 * Every condition must hold, so the gate stays quiet whenever stopping is right:
 *  - the run changed code (nothing to ship otherwise);
 *  - this host can commit AND push (the web Brain cannot);
 *  - the user asked for a change (a question answered with a scratch edit is not a
 *    work order to publish) and did not say to hold off;
 *  - nothing in the run tried to commit, push or open a pull request.
 */
export function leftChangeUnshipped(input: UnshippedChangeInput): boolean {
  return (
    input.codeChanged &&
    canShipHere(input.toolNames) &&
    asksForChange(input.requestText) &&
    !declinesShipping(input.requestText) &&
    !attemptedPublish(input.events)
  );
}

/**
 * The re-prompt. Concedes the edit is made and names what is left, rather than the
 * generic "you made zero tool calls" — a model that did plenty of work reads that as
 * wrong and argues instead of acting.
 */
export function unshippedChangeNudge(): string {
  return (
    'You changed code in this run and ended the turn without shipping it. In this local session you are the reviewer — no one else can pick the change up, so leaving it uncommitted parks its ticket in review forever. Finish it now:'
    + ' verify it (`run_command` for the type-check / tests that cover it), self-review your diff with `git_diff` and record builtin_reviews_record (verdict "complete") on the ticket tracking it,'
    + ' then `git_commit` (allowBaseBranch:true, exactly the paths you changed) and `git_push` (allowBaseBranch:true).'
    + ' If the user asked for a pull request, commit on a `branch` and `open_pull_request` instead.'
    + ' If you genuinely cannot ship — the change is unfinished, or verification fails and you cannot fix it — say so plainly at the TOP of your answer and name exactly what is left.'
  );
}
