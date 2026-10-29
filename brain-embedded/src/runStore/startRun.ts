/**
 * Starting a run — the single-flight claim on a chat's cell, the per-run reset, the
 * loop, and what a run does once it unwinds: keep what a Stop cut off, settle its ticket
 * backstops, report its coder's outcome, and hand its last step rows to the server.
 */

import { batchStepPersistence, stepDurabilityFor } from '../stepOutbox';
import { getRunDriver } from '../runDriver';
import { chatErrorAction } from '../chatError';
import { linkedTicketsToAdvance, linkedTicketsToComplete, linkedTicketsReviewedComplete } from '../chatWorkLinking';
import { asksForChange } from '@builderforce/agent-stall';
import { isChildReportText } from '@builderforce/agent-tools';
import { contentText } from '../localSuccess/turnFeatures';
import { codeRunOutcome } from '../runOutcomeReport';
import { attemptedDelegation } from '../delegationRequest';
import { shippedToBaseBranch } from '../shipVerification';
import { ticketsReviewedInPreview } from '../previewReview';
import { lineagePersistence } from '../runLineage';
import { emptyRunUsage } from '../memorySavings';
import { emit, getCell, recordRunFailure, runTrace } from './runCells';
import { appendRunMessage } from './runControl';
import { keepStoppedTurn, persistStep } from './turnPersistence';
import { recordCodeChangeTicket, updateLinkedTickets } from './runBackstops';
import { resolveServerChatId } from './serverChat';
import { runLoop } from './runLoop';
import { reportRunEnd } from './runEndOutcome';
import { beginRun } from './beginRun';
import { continueLeftovers, takeContinueOnSettle } from './continueChat';
import { markPersonTurn } from './chatAsks';
import type { BrainRunRequest } from './runTypes';
import type { RunCell } from './runCell';

/**
 * Cells whose conversation has handed work to sub-agents. A wake turn — the owner started
 * again on its children's reports — runs in the same cell with a fresh trace, so its own
 * trace shows no spawn and its children's edits are not its `codeChanged`; this is what
 * keeps such a turn from being graded as a change request it failed. Only the reports
 * turn is a wake: the person's next request in the same chat is graded as one.
 */
const delegatingCells = new WeakSet<RunCell>();

/**
 * Start (or no-op join) the agent loop for a chat. Single-flight per chat: if a
 * run is already in flight the call returns immediately, so a second mounted
 * Brain instance can never spawn a duplicate loop. The claim is synchronous
 * (set before any await), so two callers in the same tick can't both pass it.
 */
export async function startRun(runKey: number, request: BrainRunRequest): Promise<void> {
  // A host whose UI process cannot be trusted to outlive the run (see `runDriver.ts`)
  // executes it elsewhere; this store then only MIRRORS that run via applyRemoteRun.
  const driver = getRunDriver();
  if (driver) return driver.start(runKey, request);
  const c = getCell(runKey);
  if (c.running) return; // already running elsewhere — never double-fire
  // The CELL is the run's own (`runKey`); the CHAT is where it lives on the server. They
  // are the same number for a top-level run. A sub-agent has its own cell and lives in
  // its owner's chat, so from here on `chatId` is the server chat, and every message it
  // persists is attributed to the child and spliced into the owner's live view.
  const lineage = request.lineage;
  const chatId = lineage?.rootChatId ?? runKey;
  // The SERVER chat its backstops link to (PRD 36) — null on an unbound local chat.
  const serverChatId = resolveServerChatId(chatId, request);
  // Step rows are batched (see `stepOutbox.ts`) INSIDE the lineage wrap: a row is
  // attributed to the child before it is queued, so a queue replayed after a restart —
  // by the host's run-independent sender, with no run and no lineage in hand — still
  // lands attributed. With the host's step durability installed the queue is stored per
  // chat and drained on startup / reconnect.
  const steps = batchStepPersistence(request.persistence, stepDurabilityFor(chatId, runKey));
  const runPersistence = lineage
    ? lineagePersistence(steps.persistence, lineage, (msg) => appendRunMessage(chatId, msg))
    : steps.persistence;
  const req: BrainRunRequest = { ...request, persistence: runPersistence };
  c.persistStep = (ev) => persistStep(chatId, runPersistence, ev);
  beginRun(c, chatId);
  c.lastRequest = request;

  // Seed the rich transcript from prior persisted history the FIRST time we
  // touch this chat this session, then append the triggering user turn — done
  // here (inside the single-flight claim) so a racing send + auto-reply can't
  // both append the user turn to the transcript.
  if (req.seed && c.transcript.length === 0) {
    // The persisted history holds the person's own turns only — the loop's nudges are never stored.
    c.transcript = req.seed.map(markPersonTurn);
    c.priorResearch = req.priorResearch ?? null;
  }
  if (req.userTurn !== undefined) c.transcript.push(markPersonTurn({ role: 'user', content: req.userTurn }));
  emit(c);

  c.runUsage = emptyRunUsage();
  try {
    await runLoop(chatId, c, req, runKey);
  } catch (e) {
    // A user-initiated Stop aborts the stream mid-flight; that's a clean exit,
    // not an error to surface. (runLoop already returns on an aborted signal, so
    // this guards the rare throw that races the abort.)
    if (!c.abort?.signal.aborted) {
      c.error = e instanceof Error ? e.message : 'Reply failed';
      // Keep the gateway's structured entitlement verdict (402 needs-a-card /
      // needs-a-plan, 401 expired session) attached to the surfaced error, so
      // the banner can offer the fix instead of only naming the problem.
      c.errorAction = chatErrorAction(e);
      // `c.error` is this cell's memory and nothing else's. Without a durable
      // twin, reopening the chat showed the steps and then nothing at all.
      recordRunFailure(c, 'agent.run', c.error);
    }
  } finally {
    const aborted = c.abort?.signal.aborted ?? false;
    // Opted in by the conversation that launched it (the editor's host wakes its own).
    const continues = takeContinueOnSettle(runKey);
    c.running = false;
    c.streamingText = '';
    c.abort = null;
    // A Stop keeps what it cut off — the partial reply and the model that was writing it.
    if (aborted) await keepStoppedTurn(chatId, c, req.persistence).catch(() => { /* best-effort: never fail the unwind */ });
    // Guarantee a code change is tied to a ticket: if this run CHANGED code (an IDE
    // file tool succeeded) but never itself recorded/linked one, mint a ticket now
    // via from_delta, tied to this chat — so an edit is never invisible or unlinked.
    // Best-effort and IDE-only (the web Brain has no file tools → codeChanged stays
    // false). Skipped on a user Stop. Runs before the final emit so the auto-recorded
    // step is part of the settled run.
    // Post-run work is still work: minting and advancing tickets are real calls that
    // take real time. Announce the phase so the surface doesn't go blank-but-busy.
    if (!aborted && c.codeChanged && req.projectId != null && req.runTool) {
      c.activity = { phase: 'finishing', startedAt: Date.now(), step: 0 };
      emit(c);
    }
    // The ticket itself was already opened on the run's first edit (see the tool loop),
    // so this pass ATTACHES whatever was touched afterwards to that same ticket — and
    // still mints one in the case the opening call failed. It is skipped on a Stop, but
    // a stopped run is no longer the case where nothing gets recorded.
    if (!aborted && c.codeChanged && req.projectId != null && req.runTool && (!c.ticketRecorded || c.deltaTicketId != null)) {
      await recordCodeChangeTicket(serverChatId, c, req, 'settle').catch(() => { /* never fail the run on the backstop */ });
    }
    // Keep the board honest about STATUS: if this run CHANGED code, advance any
    // task/epic/gap linked to this chat that is still sitting in a not-started lane
    // (backlog/todo/ready) to in_progress — so "started work on a ticket but never
    // moved it off backlog" can't happen silently. Independent of the from_delta
    // backstop above (that MINTS a ticket; this ADVANCES existing linked ones), and
    // runs after it so a freshly-minted review-status ticket is never touched.
    // Gated on a project (like the from_delta backstop) — an IDE code-change run always
    // has one; a project-less chat has no board to reconcile.
    if (!aborted && c.codeChanged && req.projectId != null && req.runTool) {
      await updateLinkedTickets(serverChatId, c, req, linkedTicketsToAdvance, 'in_progress', 'worked-ticket-off-backlog').catch(() => { /* never fail the run on the backstop */ });
    }
    // And if the run MERGED its change to the base branch, the review lane is moot —
    // the code is live. Runs last, after the mint above, so a ticket this run created
    // and then shipped is completed rather than left at 50% forever. Gated on real
    // evidence of a push that landed, not on the run merely having touched files — and
    // on THIS run's trace only, with this run's files no longer dirty (an earlier run's
    // push, or a push that left this change uncommitted, is not this change shipping).
    // Evaluated once: it gates ticket completion AND is the reported outcome's `merged`.
    const shipped = !aborted && c.codeChanged && shippedToBaseBranch(runTrace(c), { touchedFiles: c.touchedFiles });
    if (shipped && req.projectId != null && req.runTool) {
      await updateLinkedTickets(serverChatId, c, req, linkedTicketsToComplete, 'done', 'shipped-to-base-branch').catch(() => { /* never fail the run on the backstop */ });
    }
    // The Studio's equivalent of a verified push: a "complete" review recorded after a
    // passing preview inspection of THIS run's last change. Closes exactly the tickets
    // that were reviewed — the review names its ticket, so nothing else is swept along.
    const reviewedInPreview = !aborted && c.codeChanged ? ticketsReviewedInPreview(runTrace(c)) : [];
    if (reviewedInPreview.length && req.projectId != null && req.runTool) {
      await updateLinkedTickets(
        serverChatId, c, req,
        (listed) => linkedTicketsReviewedComplete(listed, reviewedInPreview),
        'done',
        'reviewed-in-preview',
      ).catch(() => { /* never fail the run on the backstop */ });
    }
    // Teach learned routing how this run's CODER did. Not awaited — a report must
    // never hold the run open or fail it.
    // Every run — top-level or sub-agent — is graded by the same rule, on its own request.
    // A wake turn is not a request: it is the owner reading its children's reports, and
    // the work it asked for was handed to them.
    const trace = runTrace(c);
    const requestText = req.userTurn === undefined ? undefined : contentText(req.userTurn);
    const wakeTurn = delegatingCells.has(c) && isChildReportText(requestText);
    if (attemptedDelegation(trace)) delegatingCells.add(c);
    const outcome = req.reportOutcome && codeRunOutcome({
      runId: c.runId, codeModel: c.codeModel, codeChanged: c.codeChanged, aborted,
      failed: c.error !== '', shipped, trace, projectId: req.projectId,
      askedForChange: !wakeTurn && asksForChange(requestText),
    });
    if (outcome) void req.reportOutcome!(outcome).catch(() => undefined);
    // How the run ended, under the id its calls carry — the route report's other half.
    reportRunEnd(c, req, { aborted, failed: c.error !== '' });
    c.persistStep = null;
    // The run is over: nothing is in flight, so no indicator may claim otherwise.
    // Cleared LAST, after the backstops above, so `finishing` stays visible for them.
    c.activity = null;
    emit(c);
    // The run's last step rows — the terminal `agent.run` failure, `agent.stopped` —
    // leave now, not on the batch timer, and the run settles only once they have been
    // handed to the server: a caller awaiting the run must see its durable record. The
    // durable outbox queues a lane's flush behind its tail, so a fire-and-forget flush
    // landed AFTER the run resolved. Bounded: `flush` makes one send attempt per batch
    // (a failure stays queued for the outbox's own retry) and never throws. The live
    // view is already settled above, so nothing visible waits on it.
    await steps.flush();
    // Direction nobody read becomes THIS chat's next turn, whichever chat is on screen. A Stop
    // ends the conversation's work, waiting words included.
    if (continues && !aborted) await continueLeftovers(runKey, c, startRun);
  }
}
