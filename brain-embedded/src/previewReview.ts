/**
 * PREVIEW REVIEW — in the Studio the agent is the reviewer of its own change, and the
 * live preview is where it proves it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The Studio runs the app it is building in a preview in the user's browser. Measured on
 * chat #129 ("Build a marketing website for he-man"): the agent fixed a pill stretching
 * to full card height and rebuilt the mobile layout, filed a ticket for each, and stopped.
 * Both tickets opened in `in_review` (75%) and stayed there. The agent had no way to see
 * whether either fix worked — `canvas_read_build_diagnostics` said "no errors", and a
 * layout bug is not an error — so it tried to dispatch the invited QA agent to review it
 * (refused: execution switched off), and nothing else in the platform could ever move
 * those tickets: no other agent can reach a preview running in someone's browser.
 *
 * This is the Studio's twin of `selfReviewShip.ts` (the VS Code host's contract), with
 * the preview standing in for the push: the agent VERIFIES in the running app with
 * `canvas_inspect_preview`, RECORDS a review that quotes the measurements, and the run
 * CLOSES the reviewed tickets.
 *
 * Three parts, one module, so they cannot disagree about what "reviewed" means:
 *   - {@link previewReviewDirective} — the system-prompt contract.
 *   - {@link leftChangeUnreviewed} + {@link unreviewedChangeNudge} — the loop gate that
 *     re-prompts, once, a turn that changed the app and ended without a review.
 *   - {@link ticketsReviewedInPreview} — the evidence the post-run backstop closes
 *     tickets on: a passing inspection after the LAST change, then a "complete" review.
 *
 * Gated on {@link canReviewInPreview} — only the Studio advertises the inspect tool.
 * Framework-free (strings, Sets, predicates) so it is safe in every bundle.
 */

import { isFailedToolResult, type BrainTraceEvent } from './brainTriage';
import { canReviewInPreview, isCodeChangeTool, PREVIEW_REVIEW_TOOL } from './localWorkspaceTools';

const REVIEW_RECORD_TOOL = 'builtin_reviews_record';

/**
 * The directive. Uses the names the model sees: `canvas_*` for the Studio's own tools,
 * `builtin_*` for the platform ones (which also pins those into the advertised set).
 */
export function previewReviewDirective(chatId: number): string {
  return (
    'REVIEW YOUR OWN CHANGE — in this Studio session YOU are its reviewer. The app runs in a live preview in this browser that no other agent can reach, so a ticket you leave "in_review" sits at 75% on the board forever, and dispatching a QA or design agent to review it is not a substitute — even when agents are invited into this chat, the review of a change THIS session made is yours. When your turn changes the app, finish it in this order:\n' +
    '1. VERIFY — `canvas_read_build_diagnostics` must show no current failures. Then call `canvas_inspect_preview` with the CSS selectors your change targets and the widths the request is about (a phone bug: include the widths it names, or [360, 390, 414]; a desktop layout: the desktop viewport). Read the numbers against what was ASKED, not only the pass/fail: a pill that must hug its label is a few dozen px tall, not the card\'s height; a mobile menu must not make the page wider than the screen; an image must not cover the headline (`occludedBy`). If a width fails, or the measurements show the change did not do what was asked, FIX it and inspect again.\n' +
    `2. RECORD — when every width passes and the measurements match the request, record the review with builtin_reviews_record (taskId = the ticket tracking the change — builtin_chats_list_tickets with chatId=${chatId} lists it; verdict "complete"; a summary that QUOTES the measurements that prove it, e.g. ".character-tag 74×23px at 390px; page 390px wide at 390px"). One call per ticket the change delivers. If something the ticket asked for is genuinely not done, record verdict "gaps" with each gap instead of "complete".\n` +
    `3. CLOSE — a ticket linked to this chat that has a "complete" review recorded after a passing inspection moves to done (100%) automatically when your turn ends. If the ticket you reviewed is not linked yet, link it with builtin_chats_link_ticket (chatId=${chatId}) first. Report each ticket's verdict with the key measurements.\n` +
    'Never say a change works or a ticket is done without a passing `canvas_inspect_preview` AFTER your last edit. If the preview cannot be inspected (it is not running, or the probe times out), say so plainly and leave the ticket in review — do not record a "complete" review you could not verify.'
  );
}

function toolEvents(events: readonly BrainTraceEvent[]): BrainTraceEvent[] {
  return events.filter((event) => event.category === 'tool');
}

/** Index of the LAST successful app change in the run, or -1. */
function lastChangeIndex(events: readonly BrainTraceEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isCodeChangeTool(event.label) && !event.isError && !isFailedToolResult(event.result)) return index;
  }
  return -1;
}

/** A successful inspection whose verdict was `passed: true`. */
function isPassingInspection(event: BrainTraceEvent): boolean {
  if (event.label !== PREVIEW_REVIEW_TOOL || event.isError || isFailedToolResult(event.result)) return false;
  const result = event.result as { passed?: unknown } | null | undefined;
  return result?.passed === true;
}

/** The ticket a successful `builtin_reviews_record` call recorded "complete" for, or null. */
function completeReviewTaskId(event: BrainTraceEvent): number | null {
  if (event.label !== REVIEW_RECORD_TOOL || event.isError || isFailedToolResult(event.result)) return null;
  const args = (event.args ?? {}) as { taskId?: unknown; verdict?: unknown };
  // The server's verdict is authoritative (an omitted verdict with gaps reads as "gaps").
  const recorded = (event.result as { verdict?: unknown } | null | undefined)?.verdict ?? args.verdict;
  if (recorded !== 'complete') return null;
  const taskId = Number(args.taskId);
  return Number.isInteger(taskId) && taskId > 0 ? taskId : null;
}

/**
 * The tickets this run REVIEWED in the preview: each one a successful "complete"
 * `builtin_reviews_record` made after a passing `canvas_inspect_preview` that itself
 * came after the run's last app change. Ordering is the whole point — an inspection of
 * the app BEFORE the last edit reviewed a different app, and a review recorded before
 * the passing inspection was not based on it.
 *
 * Empty when the run changed nothing (there is no change to have reviewed) — a turn
 * that only inspects and reviews is a review, not a delivery, and closes nothing here.
 */
export function ticketsReviewedInPreview(events: readonly BrainTraceEvent[]): number[] {
  const tools = toolEvents(events);
  const lastChange = lastChangeIndex(tools);
  if (lastChange < 0) return [];
  let inspected = false;
  const reviewed = new Set<number>();
  for (const event of tools.slice(lastChange + 1)) {
    if (isPassingInspection(event)) inspected = true;
    else if (inspected) {
      const taskId = completeReviewTaskId(event);
      if (taskId != null) reviewed.add(taskId);
    }
  }
  return [...reviewed];
}

/** Did the run inspect the preview at all after its last change (pass or fail)? */
function inspectedAfterLastChange(events: readonly BrainTraceEvent[]): boolean {
  const tools = toolEvents(events);
  const lastChange = lastChangeIndex(tools);
  return tools.slice(lastChange + 1).some((event) => event.label === PREVIEW_REVIEW_TOOL);
}

/** Did the run record ANY review verdict (complete or gaps) after its last change? */
function recordedReviewAfterLastChange(events: readonly BrainTraceEvent[]): boolean {
  const tools = toolEvents(events);
  const lastChange = lastChangeIndex(tools);
  return tools.slice(lastChange + 1).some((event) => event.label === REVIEW_RECORD_TOOL && !event.isError);
}

/**
 * The user told the agent NOT to review or close. Narrow on purpose: an explicit negation
 * only. A request that merely does not mention reviewing is not a refusal — in the Studio
 * the agent is the reviewer, and verifying is the end of the job.
 */
const DECLINES_REVIEW =
  /\b(?:don'?t|do not|never|without)\s+(?:review|verify|inspect|test|close|closing|mark)\w*|\b(?:leave|keep)\s+(?:it|them|the\s+tickets?)\s+(?:open|in\s+review)\b/i;

export function declinesReview(text: string | null | undefined): boolean {
  return DECLINES_REVIEW.test(text ?? '');
}

/** What the loop knows when a turn ends without tool calls. */
export interface UnreviewedChangeInput {
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
 * Is this turn ending with an app change the agent never reviewed?
 *
 * Every condition must hold, so the gate stays quiet whenever stopping is right:
 *  - the run changed the app, and this host can inspect its preview (the Studio);
 *  - the user did not say to hold off reviewing. Unlike the ship gate this does NOT
 *    ask whether the request was phrased as a change: chat #129's requests were defect
 *    reports ("its height is wrong", "needs to be improved") that read as statements,
 *    and reviewing is harmless where publishing is not — a change the run MADE is the
 *    reason to verify it, whatever words prompted it;
 *  - after the last change the run neither inspected the preview NOR recorded a review.
 *    An inspection that failed and was reported, or a "gaps" verdict, is a result to
 *    relay, not to re-prompt — the nudge would only re-ask a question already answered.
 */
export function leftChangeUnreviewed(input: UnreviewedChangeInput): boolean {
  return (
    input.codeChanged &&
    canReviewInPreview(input.toolNames) &&
    !declinesReview(input.requestText) &&
    !(inspectedAfterLastChange(input.events) && recordedReviewAfterLastChange(input.events))
  );
}

/**
 * The re-prompt. Concedes the change is made and names what is left, rather than a
 * generic "keep going" a model that did plenty of work reads as wrong and argues with.
 */
export function unreviewedChangeNudge(): string {
  return (
    'You changed the app in this run and ended the turn without reviewing it. In the Studio you are the reviewer — nobody else can see this preview, so an unreviewed change parks its ticket in review forever. Finish it now:'
    + ' call `canvas_inspect_preview` with the selectors your change targets and the widths the request is about, check the measurements against what was asked (fix and re-inspect if they fail),'
    + ' then record builtin_reviews_record on each ticket the change delivers — verdict "complete" quoting the measurements, or "gaps" naming what is missing. A complete review after a passing inspection closes the ticket when your turn ends.'
    + ' If you genuinely cannot verify — the preview is not running, or the change is unfinished — say so plainly at the TOP of your answer and name exactly what is left.'
  );
}
