/**
 * OPEN LINKED WORK HOLD — the Brain's binding of the agent's `FinishPorts.openWork`: a work-mode run may not end (in prose or
 * through `finish`) while work open on its chat is still owed.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Chat #276: asked to "implement the full PRD", the run ended its last turn IN PROSE listing what it had not started ("I haven't
 * started the seeds migration or the FinanceLens change") with the linked epic still in_progress. Nothing in the finish path read
 * the linked tickets, so the run settled and the person had to send it back by hand. The last execution of a session must review
 * and update its linked tickets, and keep executing while one is unfinished.
 *
 * WHICH tickets hold the run:
 *   - the open ones it OWNS or TOUCHED (`runOwnedTicketRefs` — its delta ticket, tickets it attached a delta to, moved or
 *     created, its device filings), always;
 *   - a linked ticket already in an ACTIVE lane (`in_progress`) it never touched, only when the run is EXECUTING: the person
 *     asked for a change (`budgeted`, the same reading every progress rule uses) or the run has made progress this run. A
 *     question asked in a chat whose epic is in progress is answered and settles.
 * A not-started ticket the run never touched is the board's backlog, not this run's debt, and never holds it.
 * "Open" = task-tier, existing, not closed, not `blocked` and not `in_review` — {@link isOpenLinkedStatus}.
 *
 * Bounded: at most {@link MAX_OPEN_WORK_HOLDS} holds per run, and after the first only when the run made PROGRESS since the
 * previous hold ({@link isProgressStep}). A spent budget or a hold the model answered with no work RELEASES the run, with a trace
 * note naming the open tickets and why. Stands down for a sub-agent, a conversation (`chat`-mode) run, an aborted run, a turn that
 * asks the person a question, and a host with no tool runner. A ticket listing that cannot be read never holds the run.
 */

import { liftProseAskUser, parseAskUser } from '@builderforce/agent-loop';
import { MAX_OPEN_WORK_HOLDS, recordWorkSnapshot, type PolicyContext, type WorkEvidence } from '@builderforce/agent-run';
import { isReadOnlyShellCall } from '@builderforce/run-guards';
import { isFailedToolResult, type BrainTraceEvent } from '../brainTriage';
import { normalizeChatMode } from '../chatMode';
import { declaresChatTicketListing, isOpenLinkedStatus, linkedTaskRows, type LinkedTaskRow } from '../chatWorkLinking';
import { isCodeChangeTool, isRepoPublishTool } from '../localWorkspaceTools';
import { isWorkItemWrite } from '../workItemBookkeeping';
import type { BrainRunContext } from './brainRunContext';
import { latestStatus, listChatTickets, listingScopeOf, runOwnedTicketRefs, ticketMovesInRun, ticketsCreatedInRun } from './chatTickets';
import { continuationLimits } from './deadline';
import { budgeted } from './progressBudget';
import { nowIso, pushTrace, runTrace } from './runCells';

/** The most times one run is held for its open tickets. */
export { MAX_OPEN_WORK_HOLDS };

/** The most tickets the block lists by name; the rest are counted. */
const MAX_LISTED_TICKETS = 15;

/** The status a device-filed ticket the run never moved is read at (a fresh filing sits in the backlog). */
const UNMOVED_LOCAL_STATUS = 'backlog';

/** A linked ticket's lane that holds an EXECUTING run whoever touched it: work already under way. */
const ACTIVE_STATUS = 'in_progress';

/**
 * A step that counts as PROGRESS toward the open work: a successful call the MODEL made (not a host step) that writes or edits a
 * file, changes a ticket/task, commits or pushes, or runs a command that is not a read. Bookkeeping (remembering a fact, posting
 * to a chat) is not.
 */
function isProgressStep(ev: BrainTraceEvent): boolean {
  if (ev.category !== 'tool' || ev.isError || isFailedToolResult(ev.result)) return false;
  if ((ev.args as { auto?: unknown } | undefined)?.auto === true) return false;
  const name = ev.label;
  if (isCodeChangeTool(name) || isRepoPublishTool(name) || name === 'git_commit') return true;
  if (name === 'run_command') return !isReadOnlyShellCall(name, ev.args);
  return isWorkItemWrite(name);
}

/** The run's latest progress step, by identity — robust to the trace's bounded window dropping older steps. */
function latestProgress(trace: readonly BrainTraceEvent[]): BrainTraceEvent | null {
  for (let i = trace.length - 1; i >= 0; i--) if (isProgressStep(trace[i]!)) return trace[i]!;
  return null;
}

/**
 * The tickets this run filed on the device that are still open, read from the run's own record. A filing's status is its LATEST
 * move by trace position across both its ids (a move may name its local id or, once synced, its account id); a filing the
 * account's listing already carries (`listedRefs`) is left to the listing, which is authoritative.
 */
function localTickets(trace: readonly BrainTraceEvent[], listedRefs: ReadonlySet<string>): LinkedTaskRow[] {
  const moves = ticketMovesInRun(trace);
  return ticketsCreatedInRun(trace)
    .filter((f) => f.local && (f.syncRef == null || !listedRefs.has(f.syncRef)))
    .map((f) => ({
      ref: f.ref,
      kind: typeof f.args.taskType === 'string' ? f.args.taskType : 'task',
      title: typeof f.args.title === 'string' ? f.args.title : '',
      status: (latestStatus(moves, f.ids) ?? UNMOVED_LOCAL_STATUS).toLowerCase(),
    }));
}

/** `#ref kind "title" (status)` — one open ticket, as the model and the trace read it. */
function ticketLine(t: LinkedTaskRow): string {
  return `#${t.ref} ${t.kind}${t.title ? ` "${t.title}"` : ''} (${t.status})`;
}

/** The open tickets as a list, capped at {@link MAX_LISTED_TICKETS} with the rest counted. */
function ticketList(open: readonly LinkedTaskRow[]): string {
  const shown = open.slice(0, MAX_LISTED_TICKETS).map((t) => `- ${ticketLine(t)}`);
  if (open.length > MAX_LISTED_TICKETS) shown.push(`- +${open.length - MAX_LISTED_TICKETS} more`);
  return shown.join('\n');
}

/** The block the model reads while work is open. */
function openWorkBlock(open: readonly LinkedTaskRow[]): string {
  return (
    `You may not end this run while work open on this chat is still unfinished:\n${ticketList(open)}\n\n` +
    'Review each open ticket against its acceptance criteria and the spec it implements, then CONTINUE EXECUTING the remaining ' +
    'work now — do not summarise what is left. For an EPIC, file a child task under it (parentTaskId / parentTicketId = the ' +
    "epic's ref) for each remaining slice that has no ticket yet, and move each finished child task to done so the epic's " +
    'progress reflects reality. Move a ticket to done ONLY when its acceptance is met. The only ways to end with a ticket open: ' +
    'hand it off for review or merge (move it to "in_review"); set it to "blocked" with builtin_tasks_update and state the reason ' +
    'when it genuinely needs credentials, a live environment, or a decision only the person can make; or ask the person.'
  );
}

/** Does the turn end by asking the person (a canonical ask-user block, or a prose question with options the run lifts to one)?
 *  Shared with the spec-ticket coverage gate (`specTicketCoverageGate.ts`): asking is an allowed end for both. */
export function asksThePerson(content: string | undefined): boolean {
  return !!content && parseAskUser(liftProseAskUser(content)) != null;
}

/**
 * The `openWork` port for one Brain run. Its hold count lives with the port, which the run builds once
 * (`run/runPrepared.ts`).
 */
export function openLinkedWorkHold(run: BrainRunContext): (ctx: PolicyContext) => Promise<string | null> {
  let holds = 0;
  let released = false;
  let markAtLastHold: BrainTraceEvent | null = null;
  const tracked = new Set<string>();

  const noteOf = (ev: BrainTraceEvent): void => pushTrace(run.c, ev);
  const note = (label: string, result: string, args?: Record<string, unknown>): void => {
    noteOf({ ts: nowIso(), category: 'message', label, ...(args ? { args } : {}), result });
  };

  /** The open tickets that hold the run, or null when the account's listing cannot be read (never a hold on an unreadable listing). */
  const scopedTickets = async (trace: readonly BrainTraceEvent[], executing: boolean): Promise<LinkedTaskRow[] | null> => {
    // An unbound chat, or a host whose catalog does not declare the listing, owns only what it filed on the device.
    if (run.serverChatId == null || !declaresChatTicketListing(run.req.tools)) return localTickets(trace, new Set());
    // A run that is not executing and owns no ticket can be held by none of the listing's rows: it is not asked for (a question
    // answered in a bound chat makes no ticket call of its own).
    const owned = runOwnedTicketRefs(trace, run.c.deltaTicketId);
    if (!executing && owned.size === 0 && tracked.size === 0) return [];
    const listed = await listChatTickets(run.req, run.serverChatId, {
      note: noteOf, label: 'finish.open_work_unreadable', consequence: 'the run is not held for them.',
      // A hung listing must not hang the run's end: it is waited for no longer than the settle's own ticket bookkeeping.
      timeoutMs: continuationLimits.settleMs,
    }, listingScopeOf(run.c));
    if (listed == null) return null;
    const rows = linkedTaskRows(listed);
    const scoped = rows.filter((t) => owned.has(t.ref) || tracked.has(t.ref) || (executing && t.status === ACTIVE_STATUS));
    return [...scoped, ...localTickets(trace, new Set(rows.map((t) => t.ref)))];
  };

  const release = (open: readonly LinkedTaskRow[], reason: 'budget' | 'no_progress'): null => {
    released = true;
    const why = reason === 'budget'
      ? `it was already held ${holds} times`
      : 'it made no change after the last hold';
    note('finish.open_work_released', `The run ends with linked work still open (${open.map(ticketLine).join('; ')}): released because ${why}.`, { reason, holds, open: open.map((t) => t.ref) });
    return null;
  };

  /** Progress since the last hold. A last-hold step that fell out of the bounded trace window is NOT new progress. */
  const progressedSinceHold = (trace: readonly BrainTraceEvent[], latest: BrainTraceEvent | null): boolean => {
    if (latest == null) return false;
    if (markAtLastHold == null) return true;
    return latest !== markAtLastHold && trace.includes(markAtLastHold);
  };

  return async (ctx) => {
    const { req } = run;
    if (released || !req.runTool) return null;
    // A sub-agent works one slice of its owner's tickets: the OWNER answers for them.
    if (req.lineage || ctx.task.dispatch.parentRunId !== undefined) return null;
    // Only an EXECUTION is held to its tickets; a conversation answers and ends.
    if (normalizeChatMode(req.chatMode ?? 'work') !== 'work') return null;
    if (run.c.abort?.signal.aborted || ctx.signal?.aborted) return null;
    // Asking the person is an allowed end: the run waits on their answer.
    if (asksThePerson(ctx.content)) return null;

    const trace = runTrace(run.c);
    const latest = latestProgress(trace);
    const rows = await scopedTickets(trace, budgeted(run) || latest != null);
    if (!rows) return null;
    const evidence = rows.flatMap((ticket): WorkEvidence[] => {
      const { ref, status } = ticket;
      if (status === 'done' || status === 'completed') return [{ id: ref, status: 'done', detail: 'Ticket is marked done' }];
      if (status === 'in_review') return [{ id: ref, status, detail: 'Ticket is in review' }];
      return [];
    });
    for (const { ref } of rows) tracked.add(ref);
    if (ctx.state) {
      recordWorkSnapshot(ctx.state, 'linked-tickets', rows.map(({ ref, title }) => ({ id: ref, criteria: [title] })), evidence);
    }
    const open = rows.filter((ticket) => isOpenLinkedStatus(ticket.status));
    if (!open.length) return null;
    if (holds >= MAX_OPEN_WORK_HOLDS) return release(open, 'budget');
    if (holds > 0 && !progressedSinceHold(trace, latest)) return release(open, 'no_progress');
    holds += 1;
    markAtLastHold = latest;
    note('finish.open_work_held', `The run was held for its open linked work (${holds}/${MAX_OPEN_WORK_HOLDS}).`, { open: open.map((t) => t.ref) });
    return openWorkBlock(open);
  };
}
