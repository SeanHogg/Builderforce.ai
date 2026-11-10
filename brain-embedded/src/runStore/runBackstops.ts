/**
 * The run's TICKET BACKSTOPS — the deterministic half of "a code change is always tied
 * to a ticket, and the board says what happened to it": the delta ticket a run opens on
 * its first edit (and attaches later files to), the linked tickets it advances or
 * completes when it settles. (A work item a create tool makes links its own chat in the
 * create call — see `stampRunChat` — so there is no link backstop.) Each is best-effort,
 * records a durable step, and never fails the run.
 */

import { isFailedToolResult } from '../brainTriage';
import { NOT_STARTED_TASK_STATUSES, type LinkedTicketToAdvance } from '../chatWorkLinking';
import {
  LOCAL_TICKET_CREATE_TOOL, SERVER_TICKET_TOOLS, isLocalTicketCreateLabel, ticketStatusMove, ticketToolVocabulary,
  type TicketStatusMove,
} from '../ticketToolVocabulary';
import { syncIdText } from '@builderforce/local-first';
import { entityIdsOf } from '../toolResultRecord';
import type { BrainTraceEvent } from '../brainTriage';
import type { RunCell } from './runCell';
import { nowIso, nowMs, pushTrace } from './runCells';
import type { BrainRunRequest } from './runTypes';

/** What a ticket backstop reads and writes of a run. A live RunCell has it all; a SETTLING run gets a detached
 *  snapshot ({@link settleView}), so work that outlives its deadline never touches the NEXT run's cell. */
export type BackstopState = Pick<
  RunCell,
  'deltaRecordedFiles' | 'touchedFiles' | 'deltaTicketId' | 'ticketRecorded' | 'deltaCaptureRefused' | 'deltaTitleCount'
>;
export type BackstopRun = BackstopState & { note?: (ev: BrainTraceEvent) => void };

/** The run's state at the moment it settled, apart from the cell. Trace lines are written to the cell only while
 *  it is still THIS run's (`runId` unchanged); late work after the next run began writes nowhere. */
export function settleView(c: RunCell, runId: string): BackstopRun {
  return {
    touchedFiles: [...c.touchedFiles],
    deltaRecordedFiles: [...c.deltaRecordedFiles],
    deltaTicketId: c.deltaTicketId,
    ticketRecorded: c.ticketRecorded,
    deltaCaptureRefused: c.deltaCaptureRefused,
    deltaTitleCount: c.deltaTitleCount,
    note: (ev) => { if (c.runId === runId) pushTrace(c, ev); },
  };
}

/**
 * The message the gateway's role gate throws for a mutating call a caller's role may
 * not run (`builtinToolAuthority`). A refusal phrased this way is TERMINAL for the run:
 * the role does not change mid-run, so a settle-phase retry of the same mint can only
 * 403 again. Matched on a substring of the one stable phrase rather than the whole
 * message, which also names the tool and the caller's role.
 */
const ROLE_REFUSAL = 'requires at least the';
function isRoleRefusal(out: unknown): boolean {
  const error = (out as { error?: unknown } | null)?.error;
  return typeof error === 'string' && error.includes(ROLE_REFUSAL);
}

function noteOf(c: RunCell | BackstopRun): (ev: BrainTraceEvent) => void {
  return 'note' in c && c.note ? c.note : (ev) => pushTrace(c as RunCell, ev);
}

/**
 * ONE ticket per run: point the model's own `from_delta` call at the ticket this run
 * already opened, by filling in the `taskId` it left out.
 *
 * The run opens a delta ticket on its first edit; the model, following the same
 * directive from the other end, frequently records the delta as well. Left alone that
 * is TWO tickets for one change — worse on the board than the missing ticket the whole
 * mechanism exists to prevent. `from_delta` already takes `taskId` to attach instead of
 * mint, and the directive already tells the model to pass it; this is the deterministic
 * form of that advice. An explicit `taskId` from the model always wins — it may know a
 * better ticket than the one we minted.
 *
 * Mutates in place because that is where the dispatcher reads its arguments from.
 * A no-op for every other tool.
 */
export function attachDeltaToRunTicket(toolName: string, args: unknown, deltaTicketId: number | null): void {
  if (toolName !== 'builtin_tickets_from_delta' || deltaTicketId == null) return;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return;
  const bag = args as Record<string, unknown>;
  if (bag.taskId == null) bag.taskId = deltaTicketId;
}

/**
 * Record this run's code change as a work delta on the board, linked to the chat.
 *
 * ONE function for both moments it happens, because they are the same act with a
 * different `taskId`:
 *
 *  - `open` fires on the FIRST successful code-change tool call, mints the ticket, and
 *    remembers its id on the cell. This is what makes the guarantee survive a run that
 *    never finishes — a Stop, a closed webview, a thirteen-hour turn the user gives up
 *    on. Traceability recorded only in a `finally` block is traceability an abandoned
 *    run does not get, and an abandoned run is precisely the one whose changes are on
 *    disk with nothing on the board to explain them.
 *  - `settle` fires after the run and attaches whatever else was touched to the SAME
 *    ticket by passing `taskId`, so the second call never mints a duplicate. It also
 *    covers the case where the `open` call failed (no id, so it mints then).
 *
 * Best-effort throughout: records a durable tool step so the auto-capture is visible on
 * the timeline, and never throws.
 */
export async function recordCodeChangeTicket(
  serverChatId: number | null,
  c: RunCell | BackstopRun,
  req: BrainRunRequest,
  phase: 'open' | 'settle',
): Promise<void> {
  if (!req.runTool || req.projectId == null) return;
  // The open pass already hit a terminal refusal (the caller's role may not mint a
  // ticket) — the settle retry would 403 identically, so don't spend it.
  if (phase === 'settle' && c.deltaCaptureRefused) return;
  const known = new Set(c.deltaRecordedFiles);
  const files = c.touchedFiles.filter((f) => !known.has(f)).slice(0, 50);
  // Nothing new to say about a ticket that already exists — don't spend a call on it.
  if (phase === 'settle' && c.deltaTicketId != null && files.length === 0) return;
  const attachTo = c.deltaTicketId;
  // An unbound local chat (PRD 36) still gets its ticket — on the project, linked to no
  // chat, because it has none on the platform to link to.
  const source = serverChatId != null ? `Brain chat #${serverChatId}` : 'a local editor chat';
  const summary = files.length
    ? `Code change (${files.length} file${files.length === 1 ? '' : 's'}) from ${source}`
    : `Code change from ${source}`;
  const toolStart = nowMs();
  const args = {
    projectId: req.projectId,
    summary,
    detail:
      attachTo != null
        ? 'Auto-captured: further files changed by the same chat, attached to the ticket this run opened.'
        : 'Auto-captured: this chat changed code without recording a ticket, so the platform minted one to keep the work visible on the board and linked to the conversation.',
    files,
    kind: 'improvement',
    modality: 'ide',
    ...(serverChatId != null ? { chatId: serverChatId } : {}),
    ...(attachTo != null ? { taskId: attachTo } : {}),
  };
  let out: unknown;
  try {
    out = await req.runTool('builtin_tickets_from_delta', args);
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!isFailedToolResult(out)) {
    c.deltaRecordedFiles = [...c.deltaRecordedFiles, ...files];
    // The title carries the count of the files recorded in THIS capture; remember it so
    // the post-ship pass can re-title from the final diff (PRD 45 §4.7 B9).
    if (files.length) c.deltaTitleCount = files.length;
    // Only a MINT yields an id to attach to; an attach returns the same ticket, so
    // reading the id back off either result is correct and keeps this one branch.
    // `from_delta` answers `{ deltaId, kind, taskId, deduped }` — the TICKET is `taskId` (`id` on older
    // relays), possibly as JSON text or a numeric string. Reading only `id` left this unset, so every
    // capture minted again (chat #61651: 17 identical "Code change (1 file)" tickets).
    const id = entityIdsOf(out).syncId;
    if (c.deltaTicketId == null && id != null) c.deltaTicketId = id;
    // The model's own from_delta/link call is what `ticketRecorded` tracks; a mint we
    // performed satisfies the same guarantee, so the settle pass must not mint again.
    c.ticketRecorded = true;
  } else if (isRoleRefusal(out)) {
    // Terminal for the run: the caller's role cannot change mid-run, so the settle
    // pass must not retry a mint that can only fail the same way again.
    c.deltaCaptureRefused = true;
  }
  noteOf(c)({
    ts: nowIso(),
    category: 'tool',
    label: 'builtin_tickets_from_delta',
    durationMs: nowMs() - toolStart,
    args: { ...args, auto: true, phase },
    result: out ?? null,
    isError: isFailedToolResult(out),
  });
}

/**
 * The post-run backstops that move LINKED tickets — one pass, two reasons:
 *
 *  - ADVANCE (`in_progress`, `worked-ticket-off-backlog`): the "a ticket you WORKED
 *    reflects that on the board" guarantee. Every task/epic/gap linked to this chat that
 *    is still in a not-started lane ({@link linkedTicketsToAdvance}) moves to
 *    `in_progress` — the agent started work on linked bug tickets but left them in
 *    backlog.
 *  - COMPLETE (`done`): the loop `tickets.from_delta` has always promised and never
 *    delivered. A delta ticket opens in `in_review` and "completes automatically once
 *    merged and deployed", but the intended completer — a GitHub merge webhook — cannot
 *    fire for a change pushed straight to the base branch with no pull request, so those
 *    tickets sat at 50% forever. Two kinds of first-hand evidence close it, and the run is
 *    the only thing that will ever hold either: THIS run pushed to a base branch and
 *    verified it landed (`shipped-to-base-branch`), or — in the Studio, where there is no
 *    push — THIS run recorded a "complete" review after a passing preview inspection of
 *    its last change (`reviewed-in-preview`).
 *
 * Lists the tickets linked to this chat via the run's own `runTool` dispatcher (so it
 * rides the same gateway MCP relay the model uses); `select` says which of them the
 * evidence covers. The REASON rides on each step: a ticket that changed status by
 * itself must say what changed it, or the board's history reads as an unexplained
 * move. Best-effort and fail-closed per ticket, a durable step each, never throws. Returns how many
 * moved.
 */
export async function updateLinkedTickets(
  serverChatId: number | null,
  c: RunCell | BackstopRun,
  req: Pick<BrainRunRequest, 'runTool'>,
  select: (listed: unknown) => LinkedTicketToAdvance[],
  status: 'in_progress' | 'done',
  reason: TicketMoveReason,
): Promise<number> {
  // An unbound local chat has no linked tickets on the platform to move.
  if (!req.runTool || serverChatId == null) return 0;
  let listed: unknown;
  try {
    listed = await req.runTool('builtin_chats_list_tickets', { chatId: serverChatId });
  } catch {
    return 0; // can't read the links — nothing to move
  }
  let moved = 0;
  for (const t of select(listed)) {
    const move = ticketStatusMove(t.ref, status, SERVER_TICKET_TOOLS);
    if (move && (await moveTicket(c, req, move, reason))) moved += 1;
  }
  return moved;
}

/** Why the host moved a ticket — recorded on the step, so the board's history explains the move. */
export type TicketMoveReason = 'worked-ticket-off-backlog' | 'shipped-to-base-branch' | 'reviewed-in-preview';

/**
 * THE host's ticket status move: run one {@link ticketStatusMove} through the run's tool runner and
 * record it as a durable step. The tool receives only the move's own args; the step also says the
 * host made it (`auto`, `reason`). Best-effort, never throws; true when it moved.
 */
export async function moveTicket(
  c: RunCell | BackstopRun,
  req: Pick<BrainRunRequest, 'runTool'>,
  move: TicketStatusMove,
  reason: TicketMoveReason,
): Promise<boolean> {
  if (!req.runTool) return false;
  const toolStart = nowMs();
  let out: unknown;
  try {
    out = await req.runTool(move.tool, { ...move.args });
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const failed = isFailedToolResult(out);
  noteOf(c)({
    ts: nowIso(),
    category: 'tool',
    label: move.tool,
    durationMs: nowMs() - toolStart,
    args: { ...move.args, auto: true, reason },
    result: out ?? null,
    isError: failed,
  });
  return !failed;
}

/** The editor's vocabulary: a ticket `ticket-create` filed moves with `ticket-move`. */
const LOCAL_VOCABULARY = ticketToolVocabulary([LOCAL_TICKET_CREATE_TOOL]);
/** A status change by either vocabulary: the editor's `ticket-move` or the account's `builtin_tasks_update`. */
const MOVE_LABEL = /^(ticket[-_.]move|builtin_tasks_update)$/i;

const succeeded = (ev: BrainTraceEvent): boolean => ev.category === 'tool' && !ev.isError && !isFailedToolResult(ev.result);

/**
 * The device-local tickets THIS run's HAND-OFF filed (`ticket-create` steps recorded with
 * `reason: 'hand_off'`), in the order filed, once each — the tickets the run's own work stands
 * for. A follow-up or bug ticket the model files mid-run is NOT one: the close-out never moves it.
 * The account's chat listing cannot see a ticket that has not synced, so the run's own record is
 * the only place they can be read from.
 */
export function localTicketsFiledInRun(trace: readonly BrainTraceEvent[]): string[] {
  const ids: string[] = [];
  for (const ev of trace) {
    if (!succeeded(ev) || !isLocalTicketCreateLabel(ev.label)) continue;
    if ((ev.args as { reason?: unknown } | undefined)?.reason !== 'hand_off') continue;
    const { localId, syncId } = entityIdsOf(ev.result);
    const ref = localId ?? (syncId != null ? syncIdText(syncId) : null);
    if (ref && !ids.includes(ref)) ids.push(ref);
  }
  return ids;
}

/** The status each ticket was last moved to by a successful status move in this run, keyed by its id as text. */
function statusesInRun(trace: readonly BrainTraceEvent[]): Map<string, string> {
  const moved = new Map<string, string>();
  for (const ev of trace) {
    if (!succeeded(ev) || !MOVE_LABEL.test(ev.label)) continue;
    const a = (ev.args ?? {}) as { id?: unknown; status?: unknown };
    if ((typeof a.id === 'string' || typeof a.id === 'number') && typeof a.status === 'string') moved.set(String(a.id).trim(), a.status);
  }
  return moved;
}

/**
 * Whether the host may move a ticket last seen at `current` (undefined = not moved this run) to
 * `status`. Only forward out of a not-started lane, or from `in_progress` to `done`: a ticket the
 * run put in review, blocked, cancelled or done stays where it was put.
 */
function mayMove(current: string | undefined, status: 'in_progress' | 'done'): boolean {
  if (current === undefined || NOT_STARTED_TASK_STATUSES.has(current)) return true;
  return status === 'done' && current === 'in_progress';
}

/**
 * The close-out's moves for the run's OWN tickets the account's chat listing cannot show — the
 * same reasons {@link updateLinkedTickets} moves the account's: `in_progress` for worked tickets
 * still unmoved, `done` on the shipped and verified finish. The set is the hand-off's local
 * filings ({@link localTicketsFiledInRun}) and, on the move to done, the run's delta ticket when
 * the caller passes it (a chat with no server link, whose listing cannot see it). Never overrides a
 * status the run set itself ({@link mayMove}). A durable step each; best-effort, never throws.
 * Returns how many moved.
 */
export async function updateRunLocalTickets(
  trace: readonly BrainTraceEvent[],
  c: RunCell | BackstopRun,
  req: Pick<BrainRunRequest, 'runTool'>,
  status: 'in_progress' | 'done',
  reason: 'worked-ticket-off-backlog' | 'shipped-to-base-branch',
  deltaTicketId: number | null = null,
): Promise<number> {
  if (!req.runTool) return 0;
  const already = statusesInRun(trace);
  const moves: TicketStatusMove[] = [];
  for (const ref of localTicketsFiledInRun(trace)) {
    const move = mayMove(already.get(ref), status) ? ticketStatusMove(ref, status, LOCAL_VOCABULARY) : null;
    if (move) moves.push(move);
  }
  // The delta ticket opens in review; only the finish moves it, and only to done.
  if (status === 'done' && deltaTicketId != null && mayMove(already.get(String(deltaTicketId)), status)) {
    const move = ticketStatusMove(deltaTicketId, status, SERVER_TICKET_TOOLS);
    if (move) moves.push(move);
  }
  let moved = 0;
  for (const move of moves) if (await moveTicket(c, req, move, reason)) moved += 1;
  return moved;
}

/**
 * Re-title the run's delta ticket from the REAL diff (PRD 45 §4.7 B9).
 *
 * The title is minted on the run's FIRST edit from the files recorded THEN — usually
 * one file — and was never updated, so a change that grew to eight files read "Code
 * change (1 file)" on the board forever. At ship the final changed-path count is known
 * (`touchedFiles` holds every file this run changed, so it IS the final changed-path
 * set), and a mint with files happened (`deltaTitleCount` is set). When the final count
 * differs from the minted one, the ticket is re-titled through the same
 * `builtin_tasks_update` the other backstops use — no new writer. Best-effort: a durable
 * step records the attempt, and it never throws.
 */
export async function retitleShippedDeltaTicket(
  c: RunCell | BackstopRun,
  req: BrainRunRequest,
): Promise<void> {
  if (!req.runTool) return;
  const id = c.deltaTicketId;
  // Nothing minted with files this run, or the count already matches the title.
  if (id == null || c.deltaTitleCount == null) return;
  const finalCount = c.touchedFiles.length;
  if (finalCount === 0 || finalCount === c.deltaTitleCount) return;
  const title = `Code change (${finalCount} file${finalCount === 1 ? '' : 's'})`;
  const toolStart = nowMs();
  let out: unknown;
  try {
    out = await req.runTool('builtin_tasks_update', { id, title });
  } catch (e) {
    out = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  noteOf(c)({
    ts: nowIso(),
    category: 'tool',
    label: 'builtin_tasks_update',
    durationMs: nowMs() - toolStart,
    args: { id, title, auto: true, reason: 'retitle-shipped-delta' },
    result: out ?? null,
    isError: isFailedToolResult(out),
  });
}
