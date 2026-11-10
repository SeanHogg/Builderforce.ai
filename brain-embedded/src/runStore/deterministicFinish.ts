/**
 * DETERMINISTIC FINISH — the run's close-out as PURE HOST ACTIONS, with ZERO model turns.
 *
 * When a run has SHIPPED (its change is on the base branch) AND a linked ticket exists, the
 * runtime performs the close-out itself instead of asking the model to: record the self-review,
 * set the linked ticket to done, and write the learned fact. Each is a host action dispatched
 * through the same `req.runTool` executor the model would have reached — never through the
 * model — so a run that already shipped is not re-woken for bookkeeping it can do deterministically.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `selfReviewShip.ts` tells the model to review, commit, push, then close the ticket. A model
 * that ran out of patience said "close it out next run" instead, and the person had to send
 * ANOTHER message — that follow-up run started with an EMPTY ask and spent three model turns on
 * `builtin_reviews_record`, `builtin_tasks_update(done)` and `remember_fact` (chat #60338).
 *
 * The empty-ask continuation suppressor reads {@link finishConditionMet}: once a run shipped,
 * is verified, has no outstanding placeholder, and holds a linked ticket, there is no
 * bookkeeping left that needs a model turn, so an empty ask must NOT auto-continue the run.
 *
 * Best-effort throughout: every action is a durable step through `runTool`, and none throws past
 * the tool runner's own failures.
 */

import type { PolicyContext } from '@builderforce/agent-run';
import { linkedTicketsToComplete, linkedTicketsReviewedComplete, linkedTicketsToAdvance } from '../chatWorkLinking';
import { localTicketsFiledInRun, recordCodeChangeTicket, retitleShippedDeltaTicket, settleView, updateLinkedTickets, updateRunLocalTickets } from './runBackstops';
import { recordShipReview, verificationOf, type CloseOutInput } from '../run/brainCloseOut';
import type { BrainRunContext } from './brainRunContext';
import type { BrainRunRequest } from './runTypes';
import { nowIso, pushTrace, runTrace } from './runCells';
import { shippedToBaseBranch } from '../shipVerification';

/** The narrow FinishHook the {@link withDeterministicFinish} wrapper composes around. */
export interface InnerFinishHook {
  gate(ctx: PolicyContext): Promise<string | null> | string | null;
  settleBlock(ctx: PolicyContext): string | null;
  liveChildren?(ctx: PolicyContext): Promise<string | null>;
}

/**
 * Whether the run's finish condition is met — the gate that stops an empty-ask continuation.
 * True only when the run SHIPPED, its change is verified, no placeholder is outstanding, AND it
 * has a linked ticket to close. Once this holds, an empty ask must NOT auto-continue the run:
 * there is no bookkeeping left that needs a model turn.
 */
export function finishConditionMet(input: { shipped: boolean; verified: boolean; openPlaceholders: number; hasTicket: boolean }): boolean {
  return input.shipped && input.verified && input.openPlaceholders === 0 && input.hasTicket;
}

export interface DeterministicFinishResult {
  finished: boolean;
  reviewRecorded: boolean;
  ticketClosed: boolean;
  factWritten: boolean;
}

/**
 * Run the deterministic close-out: the host records the review on the run's ticket, moves the
 * linked ticket to done, and writes the learned fact — all as HOST ACTIONS through `req.runTool`,
 * with ZERO model turns. Idempotent: a review the run already recorded is not re-recorded, and a
 * ticket the chat no longer lists as completable is not re-moved.
 *
 * Called on EVERY settle: the ticket upkeep (attach/mint, the in_progress advance), the hold notes
 * and the preview close run whatever the gate says; only the review and the move to done wait on
 * {@link finishConditionMet}, which is what `finished` reports.
 */
export async function deterministicFinish(
  input: CloseOutInput & { verified: boolean; hasTicket: boolean },
  run: BrainRunContext,
): Promise<DeterministicFinishResult> {
  const result: DeterministicFinishResult = { finished: false, reviewRecorded: false, ticketClosed: false, factWritten: false };
  // The finish gate: ONLY the review and the move to done wait on it. The settle's ticket upkeep
  // (step 0's attach/mint and the in_progress advance), the hold notes and the preview close run
  // on every settle, gate or not.
  const finishing = finishConditionMet(input);
  // The tool runner is read from the CLOSE-OUT INPUT's req (the run's request), not the caller's
  // run context — the deterministic close-out is dispatched over the same `req.runTool` the model
  // would have reached, and tests drive it through a fake runner carried on the input.
  const req = input.req;
  if (req.projectId == null || !req.runTool) return result;

  const { view, needsTicket, shipped, reviewedInPreview } = input;
  const fullReq = req as BrainRunRequest;

  // 0. The ticket itself was opened on the run's first edit; this pass ATTACHES whatever was
  // touched afterwards to the same ticket — and still mints one in the case the opening call
  // failed. Runs on EVERY settle (independent of the finish gate), as the original close-out did.
  if (needsTicket && (!view.ticketRecorded || view.deltaTicketId != null)) {
    await recordCodeChangeTicket(input.serverChatId, view, fullReq, 'settle');
  }
  // Keep the board honest about STATUS: advance any linked task still in a not-started lane to
  // in_progress — after the mint, so a freshly minted review-status ticket is never touched.
  if (needsTicket) {
    await updateLinkedTickets(input.serverChatId, view, fullReq, linkedTicketsToAdvance, 'in_progress', 'worked-ticket-off-backlog');
    // …and the tickets this run filed on the device, which the account's listing cannot see yet.
    await updateRunLocalTickets(input.trace, view, fullReq, 'in_progress', 'worked-ticket-off-backlog');
  }

  // 1. Shipped: re-title the delta ticket (PRD 45 §4.7 B9), then close it out. The acceptance the
  // completion guard holds a model's `done` to holds the host's too: a placeholder left in the code
  // keeps the ticket open, and the step says so instead of closing it. Shipping is not verification:
  // with no passing evidence for the change, nobody reviewed it — the host records no review, moves
  // nothing to done, and says why. These holds are exactly where `finishing` is false for a shipped
  // run, so the hold note is what tells the trace WHY the review and the move to done did not happen.
  if (shipped && req.projectId != null) {
    await retitleShippedDeltaTicket(view, fullReq);
    if (input.openPlaceholders > 0) {
      view.note?.({
        ts: nowIso(), category: 'message', label: 'run.close_out_held',
        args: { reason: 'placeholders', open: input.openPlaceholders },
        result: 'The change shipped, but this run left placeholders in the code: its ticket stays open until they are finished.',
      });
    } else {
      const verification = verificationOf(input.evidence, view.touchedFiles);
      if (!verification.verified) {
        view.note?.({
          ts: nowIso(), category: 'message', label: 'run.close_out_held',
          args: { reason: 'unverified', detail: verification.reason },
          result: `The change shipped, but this run holds no passing verification for it (${verification.reason}): no review was recorded and its ticket stays in review.`,
        });
      } else if (finishing && view.deltaTicketId != null) {
        await recordShipReview(input, view.deltaTicketId, verification.checks);
        result.reviewRecorded = true;
      }
    }
  }

  // 2. Move the linked ticket(s) to done — only when the finish gate holds, and only those the chat
  // still lists as completable. The review (step 1) ran first; this closes the linked ticket(s).
  // An unbound chat (no server chat) has no listing to read: its tickets close in the pass below.
  // The tool receives only `{ id, status }`; the recorded step carries why (`auto`, the reason), so a
  // ticket that closed itself is never an unexplained status change in the board's history.
  if (finishing && (await updateLinkedTickets(run.serverChatId, view, req, linkedTicketsToComplete, 'done', 'shipped-to-base-branch')) > 0) result.ticketClosed = true;
  // The run's OWN tickets close on the same finish: the hand-off's local filings, read from its own
  // record — and its delta ticket when no server chat lists it.
  const unlistedDelta = run.serverChatId == null ? view.deltaTicketId : null;
  if (finishing && (await updateRunLocalTickets(input.trace, view, fullReq, 'done', 'shipped-to-base-branch', unlistedDelta)) > 0) result.ticketClosed = true;

  // 3. The Studio's equivalent of a verified push: a "complete" review after a passing preview
  // inspection of THIS run's last change. Closes exactly the tickets that were reviewed — on its own
  // evidence, independent of the ship gate.
  if (reviewedInPreview.length && req.projectId != null) {
    await updateLinkedTickets(input.serverChatId, view, fullReq, (l) => linkedTicketsReviewedComplete(l, reviewedInPreview), 'done', 'reviewed-in-preview');
  }

  // The learned fact is written by the host's learn reconcile alongside this close-out (host-side,
  // not a runTool call), so `factWritten` stays false. `finished` is the gate: the close-out ran.
  result.finished = finishing;
  return result;
}

/**
 * Run the deterministic finish via the named entry: the settle's ticket upkeep always runs; returns
 * true when {@link finishConditionMet} held and the close-out (review + move to done) ran.
 */
export async function runDeterministicFinish(input: CloseOutInput & { verified: boolean; hasTicket: boolean }, run: BrainRunContext): Promise<boolean> {
  return (await deterministicFinish(input, run)).finished;
}

/** Did this run SHIP its change (commit pushed to a base branch)? */
function shippedOf(run: BrainRunContext): boolean {
  return run.c.codeChanged && run.c.touchedFiles.length > 0 &&
    shippedToBaseBranch(runTrace(run.c), { touchedFiles: run.c.touchedFiles });
}

/** Does the run hold a LINKED ticket to close out — one the chat carries, or one it filed on the device? */
async function hasLinkedTicket(run: BrainRunContext): Promise<boolean> {
  return holdsLinkedTicket(runTrace(run.c), run.serverChatId, run.req);
}

/**
 * THE "holds a ticket to close" read, shared by the driver-run close-out and the `startRun` settle:
 * a ticket the run filed on the device, or one the account's chat listing still shows as completable
 * (a ticket the chat links whose delta id this run never read back counts — it is still the run's).
 */
export async function holdsLinkedTicket(
  trace: Parameters<typeof localTicketsFiledInRun>[0],
  serverChatId: number | null,
  req: Pick<BrainRunRequest, 'runTool'>,
): Promise<boolean> {
  if (!req.runTool) return false;
  if (localTicketsFiledInRun(trace).length > 0) return true;
  if (serverChatId == null) return false;
  let listed: unknown;
  try { listed = await req.runTool('builtin_chats_list_tickets', { chatId: serverChatId }); } catch { return false; }
  return linkedTicketsToComplete(listed).length > 0;
}

/**
 * Perform the deterministic close-out for a run `startRun` never drives (a driver-executed run),
 * as the kernel judges the finish. Stands down when `startRun` already closed the run out
 * (`c.finishClosedOut`), keeping the close-out single-writer across both paths.
 */
async function finishCloseOut(run: BrainRunContext): Promise<void> {
  const c = run.c;
  if (c.finishClosedOut) return;
  const { req } = run;
  if (req.projectId == null || !req.runTool || c.abort?.signal.aborted || !c.codeChanged) return;
  if (!shippedOf(run)) return;
  if (!(await hasLinkedTicket(run))) return;
  const openPlaceholders = run.placeholderLedger.outstanding().length;
  const view = settleView(c, c.runId);
  const input: CloseOutInput = {
    serverChatId: run.serverChatId, view, req, needsTicket: true, shipped: true,
    reviewedInPreview: [], openPlaceholders, trace: runTrace(c), evidence: run.evidence,
  };
  // Verified from the run's own evidence, as the startRun settle does: a driver-run finish
  // with no passing check must not move its tickets to done.
  const verified = verificationOf(run.evidence, view.touchedFiles).verified;
  await deterministicFinish({ ...input, verified, hasTicket: true }, run);
}

/**
 * The deterministic-finish wrapper around a finish hook. `gate` runs the close-out (awaited, so
 * the actions complete before the run settles) and then delegates to the inner gate — the
 * close-out NEVER refuses a finish. `settleBlock` and `liveChildren` pass through untouched.
 */
export function withDeterministicFinish<T extends InnerFinishHook>(run: BrainRunContext, inner: T): T {
  return {
    ...inner,
    gate: async (ctx: PolicyContext) => {
      // Best-effort: a close-out failure must not refuse the finish (the gate below is the
      // authority), but the reason is traced on the run so a failed close-out is diagnosable, not silent.
      await finishCloseOut(run).catch((reason: unknown) => {
        pushTrace(run.c, {
          ts: nowIso(),
          category: 'message',
          label: 'finish.close_out_error',
          result: `The close-out failed: ${reason instanceof Error ? reason.message : String(reason)}. The finish goes on; its tickets were not moved.`,
        });
      });
      return inner.gate(ctx);
    },
  };
}
