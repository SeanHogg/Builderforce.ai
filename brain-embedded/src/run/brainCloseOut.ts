/**
 * The run's CLOSE-OUT: the host actions a settled run's ticket bookkeeping takes, with ZERO model turns.
 *
 * Extracted from `startRun.ts`'s settle (the one place it ran) so the whole close-out is one unit: the delta ticket's last
 * attach, advancing linked tickets off the backlog, and - when THIS run shipped - the review and the move to done.
 *
 * Before, a run that pushed its change still owed the review: `selfReviewShip.ts` tells the model to record it, and a model
 * that ran out of patience said "close it out next run" instead (chat #60338). The person had to send another message, and
 * that run spent three model turns on `builtin_reviews_record`, `builtin_tasks_update(done)` and `remember_fact`. Now the HOST
 * records the review on the ticket THIS run created, through the same tool executor (`req.runTool`) the model would have
 * reached - never through the model - and only when the acceptance the existing gates hold is met: the change landed on the
 * base branch (`shippedToBaseBranch`) and no placeholder this run wrote is outstanding (`completionGuard.ts`). A held
 * close-out is a trace step saying why; nothing is forced done. The learned facts are already written host-side at run end
 * (`emitEvermindLearnReconcile`, and the editor's run note), so no fact writer is added here.
 *
 * Best-effort throughout: every action is a durable step, and none throws (the callers bound it by the settle deadline).
 */

import { isFailedToolResult, type BrainTraceEvent } from '../brainTriage';
import { linkedTicketsReviewedComplete, linkedTicketsToAdvance, linkedTicketsToComplete } from '../chatWorkLinking';
import { nowIso, nowMs } from '../runStore/runCells';
import { recordCodeChangeTicket, retitleShippedDeltaTicket, updateLinkedTickets, type BackstopRun } from '../runStore/runBackstops';
import type { BrainRunRequest } from '../runStore/runTypes';

/** The tool a review is recorded with - the model's and the host's alike. */
export const REVIEW_RECORD_TOOL = 'builtin_reviews_record';

/** What the close-out decides on, read from THIS run as it settled (never later from a cell the next run may use). */
export interface CloseOutInput {
  /** The server chat the run's tickets are linked to (null on an unbound local chat). */
  serverChatId: number | null;
  /** The run's detached settle snapshot (`settleView`). */
  view: BackstopRun;
  req: Pick<BrainRunRequest, 'runTool' | 'projectId'>;
  /** The run changed code and may mint/advance tickets (not stopped, a project, a tool runner). */
  needsTicket: boolean;
  /** The run's change landed on the base branch (`shippedToBaseBranch`). */
  shipped: boolean;
  /** Tickets the run reviewed complete after a passing preview inspection (`ticketsReviewedInPreview`). */
  reviewedInPreview: readonly number[];
  /** Placeholders this run wrote and has not removed (`PlaceholderLedger.outstanding().length`). */
  openPlaceholders: number;
  /** THIS run's trace, for the reviews it recorded itself. */
  trace: readonly BrainTraceEvent[];
}

/** The tickets THIS run recorded a successful review for itself. */
export function reviewedThisRun(trace: readonly BrainTraceEvent[]): Set<number> {
  const ids = new Set<number>();
  for (const ev of trace) {
    if (ev.category !== 'tool' || ev.label !== REVIEW_RECORD_TOOL || ev.isError || isFailedToolResult(ev.result)) continue;
    const id = Number((ev.args as { taskId?: unknown } | undefined)?.taskId);
    if (Number.isInteger(id)) ids.add(id);
  }
  return ids;
}

/** The review the host records for a shipped change: the evidence it holds, nothing it does not. */
function shipReviewSummary(files: readonly string[]): string {
  const shown = files.slice(0, 10).join(', ');
  const more = files.length > 10 ? ` (+${files.length - 10} more)` : '';
  return `Closed out by the host: this run's change${files.length ? ` (${files.length} file${files.length === 1 ? '' : 's'}: ${shown}${more})` : ''} was pushed to the base branch and verified landed, with no placeholder outstanding.`;
}

/** Record the host's review on the ticket THIS run created, unless the run recorded one itself. */
async function recordShipReview(input: CloseOutInput, taskId: number): Promise<void> {
  const { view, req } = input;
  if (!req.runTool || reviewedThisRun(input.trace).has(taskId)) return;
  const args = { taskId, verdict: 'complete', summary: shipReviewSummary(view.touchedFiles) };
  const toolStart = nowMs();
  let out: unknown;
  try {
    out = await req.runTool(REVIEW_RECORD_TOOL, args);
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  view.note?.({
    ts: nowIso(),
    category: 'tool',
    label: REVIEW_RECORD_TOOL,
    durationMs: nowMs() - toolStart,
    args: { ...args, auto: true, reason: 'shipped-to-base-branch' },
    result: out ?? null,
    isError: isFailedToolResult(out),
  });
}

/** Run the close-out. Each step is skipped when its evidence is absent; none throws past the tool runner's own failures. */
export async function closeOutRun(input: CloseOutInput): Promise<void> {
  const { serverChatId, view, needsTicket, shipped, reviewedInPreview } = input;
  const req = input.req as BrainRunRequest;
  // The ticket itself was already opened on the run's first edit (see the tool loop), so this pass ATTACHES whatever was
  // touched afterwards to that same ticket - and still mints one in the case the opening call failed.
  if (needsTicket && (!view.ticketRecorded || view.deltaTicketId != null)) {
    await recordCodeChangeTicket(serverChatId, view, req, 'settle');
  }
  // Keep the board honest about STATUS: advance any linked task still in a not-started lane to in_progress - after the mint,
  // so a freshly minted review-status ticket is never touched.
  if (needsTicket) {
    await updateLinkedTickets(serverChatId, view, req, linkedTicketsToAdvance, 'in_progress', 'worked-ticket-off-backlog');
  }
  if (shipped && req.projectId != null && req.runTool) {
    // PRD 45 §4.7 B9: the delta ticket's title carries the file-count minted on the first edit; re-title it at ship.
    await retitleShippedDeltaTicket(view, req);
    // The acceptance the completion guard holds a model's `done` to holds the host's too: a placeholder left in the code
    // keeps the ticket open, and the step says so instead of closing it.
    if (input.openPlaceholders > 0) {
      view.note?.({
        ts: nowIso(),
        category: 'message',
        label: 'run.close_out_held',
        args: { reason: 'placeholders', open: input.openPlaceholders },
        result: 'The change shipped, but this run left placeholders in the code: its ticket stays open until they are finished.',
      });
    } else {
      if (view.deltaTicketId != null) await recordShipReview(input, view.deltaTicketId);
      await updateLinkedTickets(serverChatId, view, req, linkedTicketsToComplete, 'done', 'shipped-to-base-branch');
    }
  }
  // The Studio's equivalent of a verified push: a "complete" review after a passing preview inspection of THIS run's last
  // change. Closes exactly the tickets that were reviewed.
  if (reviewedInPreview.length && req.projectId != null && req.runTool) {
    await updateLinkedTickets(serverChatId, view, req, (listed) => linkedTicketsReviewedComplete(listed, reviewedInPreview), 'done', 'reviewed-in-preview');
  }
}
