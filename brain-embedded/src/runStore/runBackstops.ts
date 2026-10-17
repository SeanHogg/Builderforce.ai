/**
 * The run's TICKET BACKSTOPS — the deterministic half of "a code change is always tied
 * to a ticket, and the board says what happened to it": the delta ticket a run opens on
 * its first edit (and attaches later files to), the linked tickets it advances or
 * completes when it settles, and the chat link for every work item a create tool made.
 * Each is best-effort, records a durable step, and never fails the run.
 */

import { isFailedToolResult } from '../brainTriage';
import { workItemLinkFromCreate, type LinkedTicketToAdvance } from '../chatWorkLinking';
import type { RunCell } from './runCell';
import { nowIso, nowMs, pushTrace } from './runCells';
import type { BrainRunRequest } from './runTypes';

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
  chatId: number,
  c: RunCell,
  req: BrainRunRequest,
  phase: 'open' | 'settle',
): Promise<void> {
  if (!req.runTool || req.projectId == null) return;
  const known = new Set(c.deltaRecordedFiles);
  const files = c.touchedFiles.filter((f) => !known.has(f)).slice(0, 50);
  // Nothing new to say about a ticket that already exists — don't spend a call on it.
  if (phase === 'settle' && c.deltaTicketId != null && files.length === 0) return;
  const attachTo = c.deltaTicketId;
  const summary = files.length
    ? `Code change (${files.length} file${files.length === 1 ? '' : 's'}) from Brain chat #${chatId}`
    : `Code change from Brain chat #${chatId}`;
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
    chatId,
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
    // Only a MINT yields an id to attach to; an attach returns the same ticket, so
    // reading the id back off either result is correct and keeps this one branch.
    const id = (out as { id?: unknown } | null)?.id;
    if (c.deltaTicketId == null && typeof id === 'number') c.deltaTicketId = id;
    // The model's own from_delta/link call is what `ticketRecorded` tracks; a mint we
    // performed satisfies the same guarantee, so the settle pass must not mint again.
    c.ticketRecorded = true;
  }
  pushTrace(c, {
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
 * move. Best-effort and fail-closed per ticket, a durable step each, never throws.
 */
export async function updateLinkedTickets(
  chatId: number,
  c: RunCell,
  req: BrainRunRequest,
  select: (listed: unknown) => LinkedTicketToAdvance[],
  status: 'in_progress' | 'done',
  reason: 'worked-ticket-off-backlog' | 'shipped-to-base-branch' | 'reviewed-in-preview',
): Promise<void> {
  if (!req.runTool) return;
  let listed: unknown;
  try {
    listed = await req.runTool('builtin_chats_list_tickets', { chatId });
  } catch {
    return; // can't read the links — nothing to move
  }
  for (const t of select(listed)) {
    const id = Number(t.ref);
    if (!Number.isInteger(id)) continue;
    const toolStart = nowMs();
    let out: unknown;
    try {
      out = await req.runTool('builtin_tasks_update', { id, status });
    } catch (e) {
      out = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    pushTrace(c, {
      ts: nowIso(),
      category: 'tool',
      label: 'builtin_tasks_update',
      durationMs: nowMs() - toolStart,
      args: { id, status, auto: true, reason },
      result: out ?? null,
      isError: isFailedToolResult(out),
    });
  }
}

/**
 * Deterministic chat↔work link for an item a create tool just produced. If `out` is
 * the result of a recognised create tool (see {@link workItemLinkFromCreate}), fire
 * the shared `builtin_chats_link_ticket` tool — via the run's own dispatcher so it
 * rides the same gateway MCP relay the model uses — so the new Epic / task / OKR /
 * spec is tied to this conversation for traceability. Idempotent (re-linking is a
 * no-op update), best-effort (never fails the run), and recorded as a durable step so
 * the auto-link is visible on the timeline. Marks the run as having recorded a ticket
 * so the from_delta backstop stays quiet.
 */
export async function autoLinkCreatedItem(
  chatId: number,
  c: RunCell,
  runTool: (name: string, args: unknown) => Promise<unknown>,
  toolName: string,
  out: unknown,
): Promise<void> {
  const link = workItemLinkFromCreate(toolName, out);
  if (!link) return;
  const toolStart = nowMs();
  let result: unknown;
  try {
    result = await runTool('builtin_chats_link_ticket', {
      chatId,
      kind: link.kind,
      ref: link.ref,
      linkType: link.linkType,
    });
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!isFailedToolResult(result)) c.ticketRecorded = true;
  pushTrace(c, {
    ts: nowIso(),
    category: 'tool',
    label: 'builtin_chats_link_ticket',
    durationMs: nowMs() - toolStart,
    args: { chatId, kind: link.kind, ref: link.ref, linkType: link.linkType, auto: true },
    result: result ?? null,
    isError: isFailedToolResult(result),
  });
}
