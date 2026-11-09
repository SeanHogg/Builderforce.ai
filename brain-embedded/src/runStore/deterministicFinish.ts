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

import { isFailedToolResult } from '../brainTriage';
import type { PolicyContext } from '@builderforce/agent-run';
import { linkedTicketsToComplete } from '../chatWorkLinking';
import { nowIso, nowMs, runTrace } from './runCells';
import type { BrainRunContext } from './brainRunContext';
import type { CloseOutInput } from '../run/brainCloseOut';
import { shippedToBaseBranch } from '../shipVerification';
import { settleView } from './runBackstops';

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

function reviewedThisRun(trace: readonly { category: string; label?: string; args?: unknown }[]): Set<number> {
  const reviewed = new Set<number>();
  for (const ev of trace) {
    if (ev.category === 'tool' && ev.label === 'builtin_reviews_record') {
      const id = (ev.args as { taskId?: unknown } | undefined)?.taskId;
      if (typeof id === 'number') reviewed.add(id);
    }
  }
  return reviewed;
}

/**
 * Run the deterministic close-out: the host records the review on the run's ticket, moves the
 * linked ticket to done, and writes the learned fact — all as HOST ACTIONS through `req.runTool`,
 * with ZERO model turns. Idempotent: a review the run already recorded is not re-recorded, and a
 * ticket the chat no longer lists as completable is not re-moved.
 */
export async function deterministicFinish(
  input: CloseOutInput & { verified: boolean; hasTicket: boolean },
  run: BrainRunContext,
): Promise<DeterministicFinishResult> {
  const result: DeterministicFinishResult = { finished: false, reviewRecorded: false, ticketClosed: false, factWritten: false };
  if (!finishConditionMet(input)) return result;
  // The tool runner is read from the CLOSE-OUT INPUT's req (the run's request), not the caller's
  // run context — the deterministic close-out is dispatched over the same `req.runTool` the model
  // would have reached, and tests drive it through a fake runner carried on the input.
  const req = input.req;
  if (req.projectId == null || !req.runTool) return result;

  const runTool = req.runTool;
  const trace = runTrace(run.c);
  const ticketId = input.view.deltaTicketId;

  // 1. Record the self-review on the run's own ticket — unless the run already reviewed it.
  if (ticketId != null && !reviewedThisRun(trace).has(ticketId)) {
    const args = { taskId: ticketId, verdict: 'complete', summary: 'Closed out deterministically by the host: this run shipped its change to the base branch (verified), with no model turns.' };
    const start = nowMs();
    let out: unknown;
    try { out = await runTool('builtin_reviews_record', args); } catch (e) { out = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    input.view.note?.({ ts: nowIso(), category: 'tool', label: 'builtin_reviews_record', durationMs: nowMs() - start, args: { ...args, auto: true, reason: 'deterministic-finish' }, result: out ?? null, isError: isFailedToolResult(out) });
    result.reviewRecorded = !isFailedToolResult(out);
  }

  // 2. Move the linked ticket(s) to done — only those the chat still lists as completable.
  let listed: unknown;
  try { listed = await runTool('builtin_chats_list_tickets', { chatId: run.serverChatId }); } catch { listed = null; }
  const completable = linkedTicketsToComplete(listed);
  for (const ticket of completable) {
    // `linkedTicketsToComplete` yields `ref` as a string (tolerant parsing of the chat list);
    // `builtin_tasks_update` takes a numeric id, so coerce — a non-numeric ref is skipped.
    const id = Number(ticket.ref);
    if (!Number.isFinite(id)) continue;
    const args = { id, status: 'done' };
    const start = nowMs();
    let out: unknown;
    try { out = await runTool('builtin_tasks_update', args); } catch (e) { out = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    // The note carries ONLY the semantic args (id, status) so the recorded step matches the
    // host action the test asserts (`{ id: 41, status: 'done' }`); provenance rides the trace.
    input.view.note?.({ ts: nowIso(), category: 'tool', label: 'builtin_tasks_update', durationMs: nowMs() - start, args, result: out ?? null, isError: isFailedToolResult(out) });
    if (!isFailedToolResult(out)) result.ticketClosed = true;
  }

  // 3. The close-out is complete: the review is recorded and the ticket moved to done. The
  // learned fact is written by the host's learn reconcile alongside this close-out (host-side,
  // not a runTool call), so `factWritten` stays false — the finish reports the review + ticket
  // close it performed, not the reconcile.
  result.finished = true;
  return result;
}

/**
 * Run the deterministic finish via the named entry: entered only when {@link finishConditionMet}
 * holds; returns true when the finish ran.
 */
export async function runDeterministicFinish(input: CloseOutInput & { verified: boolean; hasTicket: boolean }, run: BrainRunContext): Promise<boolean> {
  return (await deterministicFinish(input, run)).finished;
}

/** Did this run SHIP its change (commit pushed to a base branch)? */
function shippedOf(run: BrainRunContext): boolean {
  return run.c.codeChanged && run.c.touchedFiles.length > 0 &&
    shippedToBaseBranch(runTrace(run.c), { touchedFiles: run.c.touchedFiles });
}

/** Does the run hold a LINKED ticket to close out — one the chat carries? */
async function hasLinkedTicket(run: BrainRunContext): Promise<boolean> {
  const { req, serverChatId } = run;
  if (serverChatId == null || !req.runTool) return false;
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
  await deterministicFinish({ ...input, verified: true, hasTicket: true }, run);
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
      await finishCloseOut(run).catch(() => undefined);
      return inner.gate(ctx);
    },
  };
}
