/**
 * A chat's linked-ticket progress: ONE rollup and ONE display rule, for every surface
 * that shows "how done is this conversation's work".
 *
 * Three surfaces show that number for one chat: the ticket rail's header ring, the
 * conversation picker, and the VS Code Sessions tree. They used to compute it in two
 * hand-synced copies (the server's `rollupChatTicketHealth` and the rail's
 * `aggregateTicketHealth`), and the tree floored a value the other two rounded. So one
 * chat could read 23%, 60% and 18% at the same moment. This module is the only
 * definition. The api, the rail and the tree all import it from here.
 *
 * WHY THIS IS NOT Σdone / Σtotal
 * `done`/`total` count COMPLETED ITEMS, not progress. A leaf task reports `total: 1`
 * and `done: 1` only once it reaches a done status, so a task in review is
 * `done: 0, total: 1` even though its own ring reads 75%. Σdone/Σtotal discards every
 * partial contribution and, for a flat list of leaf tasks, can only read 0% or 100%.
 * `progressPct` IS what each ticket's ring renders, so the rollup averages that,
 * weighted by `total` so a ten-child epic outweighs a single leaf task.
 *
 * - A ticket with `total: 0` (legacy spec/roadmap/retro, a deleted item) still weighs
 *   1, so a 0% ring cannot vanish from the headline.
 * - Cancelled is closed: the server reports its own ring at 100%. It is still skipped
 *   here (US `canceled` too) so an older row still carrying `progressPct: 0` cannot
 *   drag "3 done + 1 cancelled" down to 75%, and so the "4/6" counter counts only
 *   work that was delivered. An all-cancelled list is 100% (nothing owed). An empty
 *   list is 0%.
 * - A DELETED ticket (`exists: false`, the server's `(deleted)` placeholder) is skipped
 *   exactly like cancelled: the target no longer resolves, so it is removed work, not
 *   remaining work. Without this, "6 done + 1 deleted" read 86% · 6/7 — the deleted
 *   placeholder's `progressPct: 0` dragged the headline down and the "6/7" counter
 *   counted it. An all-deleted list is 100% (nothing owed), like all-cancelled.
 * - `done`/`total` are still returned for the "4/6" counter beside the percent.
 *
 * EXACT 100 IS THE ONLY COMPLETION SIGNAL, AND ONLY A CLOSED TICKET MAY EMIT IT
 * A ticket whose own status is not closed for its KIND never reads 100, whatever its
 * raw figure says: an open epic whose filed children are all done, an open task whose
 * PR merged, an initiative still `active` with every child task done, an objective
 * `active` whose key results all hit target, a poker session `active` with every story
 * estimated — each reads {@link CLAIMED_COMPLETE_PROGRESS_CAP} (75): claimed complete,
 * not closed, the same rung as `in_review`. Real work (unfiled slices, review, the close
 * itself) can still remain while the item is open, so the ring must not say "done"
 * before the item does (chat #276: epic in_progress with two done children read 100).
 * The cap never raises a lower figure. Conversely a CLOSED ticket always reads 100, even
 * an epic closed with only 3 of 5 children done — "done" means the item is closed.
 *
 * "Closed" is per kind, from the ONE registry `TICKET_CLOSED_STATES`
 * (`ticketClosedStates.ts`): task/gap/epic close at `TASK_CLOSED_STATUSES`, a spec at
 * `complete`, a roadmap item at `shipped`, an initiative at `completed`, an objective at
 * `achieved`, a ceremony at `completed` … A custom board's terminal lane whose key is not
 * in the kind's list is not closed to this rule: it reads 75 until the ticket moves to a
 * closed lane. A kind with NO declared vocabulary (or no kind at all) keeps the old
 * behaviour: closed by the task lanes' words only, and never capped.
 *
 * The rule is {@link effectiveTicketProgress}, applied ONCE per surface: the server's
 * ticket health (every kind), this rollup (each input's `kind`), and the rail's mapping
 * of a record. It is idempotent, so a figure a producer already applied it to passes
 * through unchanged.
 *
 * OPEN / COMPLETED TICKETS
 * `openTickets` / `completedTickets` count TICKETS (not sub-items) for the history
 * row's "3 open · 2 done" line. A ticket is completed when its effective progress is
 * at least 100, which for a kind with a declared vocabulary means it is closed.
 * Cancelled tickets (the kind's cancelled words — a missed objective too) count as
 * neither. open = counted − completed, so an empty or all-cancelled list is 0 / 0.
 */

import { hasTicketStatusVocabulary, isCancelledTicketStatus, isClosedTicketStatus } from "./ticketClosedStates.js";

export interface ChatTicketHealthInput {
  /**
   * The ticket kind (task, epic, spec, initiative …) whose status vocabulary decides
   * "closed" and "cancelled". Absent: the task lanes' words, never capped.
   */
  kind?: string | null;
  /** Authoritative progress for this ticket, 0–100. */
  progressPct: number;
  /** Completed sub-items (a leaf task is 0 or 1). */
  done: number;
  /** Total sub-items (a leaf task is 1). */
  total: number;
  /** Lane key. Cancelled work is skipped — it is off the board, not remaining. */
  status?: string | null;
  /**
   * False when the referenced ticket no longer resolves (the platform deleted it).
   *   A deleted item is removed work, not remaining work: it is skipped exactly like
   *   a cancelled lane, so its placeholder `progressPct: 0` cannot drag the headline
   *   down or sit in the open/completed ticket counts. Absent/undefined means the
   *   ticket exists (every producer that knows the flag passes it).
   */
  exists?: boolean;
}

/**
 * Ceiling for a ticket whose raw progress reads complete while its own status is still
 * open for its kind. Same rung as `in_review` on the status ladder: claimed complete,
 * not closed. Exact 100 is the only completion signal and only a closed ticket may emit it.
 */
export const CLAIMED_COMPLETE_PROGRESS_CAP = 75;

export interface ChatTicketHealth {
  /** Overall progress 0–100. */
  pct: number;
  /** Completed items across the counted tickets. */
  done: number;
  /** Items across the counted tickets. */
  total: number;
  /** Counted (non-cancelled) tickets whose effective progress is below 100. */
  openTickets: number;
  /** Counted (non-cancelled) tickets whose effective progress is 100 or more. */
  completedTickets: number;
}

/**
 * True when this ticket must not sit in the chat-health denominator: cancelled for its
 * kind (the shared cancelled spellings for every kind, plus the kind's own cancelled
 * words from `TICKET_CLOSED_STATES`, e.g. a missed objective).
 */
export function isExcludedFromChatHealth(status?: string | null, kind?: string | null): boolean {
  return isCancelledTicketStatus(kind, status);
}

/**
 * The ONE "what does a ticket's progress read" rule, shared by the server's ticket
 * health (every kind, including the task status ladder `buildTaskProgressBreakdown`),
 * the chat rollup below, and the rail (`railTicketProgress`).
 *
 * Exact 100 is the only completion signal, and only a closed ticket may emit it:
 * - closed for its `kind` (`isClosedTicketStatus`) → 100, whatever the raw figure: a
 *   closed item IS complete, so a stale, partial or demoted record percent never wins
 *   and a DONE badge can never sit beside a 75% ring;
 * - open, raw ≥ 100, and the kind declares a status vocabulary →
 *   {@link CLAIMED_COMPLETE_PROGRESS_CAP} (the cap never raises a lower figure);
 * - otherwise the raw figure.
 *
 * `kind` is required (pass `'task'` for a task lane) so no caller can silently fall into
 * the unknown-kind branch. A kind with no declared vocabulary — or `null`, "kind
 * unknown" — is closed only by the task lanes' words and never capped.
 * Idempotent: applying it to its own output changes nothing.
 */
export function effectiveTicketProgress(
  status: string | null | undefined,
  progressPct: number | null | undefined,
  kind: string | null,
): number {
  const raw = typeof progressPct === "number" && Number.isFinite(progressPct) ? progressPct : 0;
  if (isClosedTicketStatus(kind, status)) return Math.max(raw, 100);
  if (raw >= 100 && hasTicketStatusVocabulary(kind)) return CLAIMED_COMPLETE_PROGRESS_CAP;
  return raw;
}

function effectiveProgressPct(t: ChatTicketHealthInput): number {
  // An input with no kind keeps the kind-unknown behaviour (closed floor only).
  return effectiveTicketProgress(t.status, t.progressPct, t.kind ?? null);
}

/** Roll a chat's linked tickets up into its one progress figure. */
export function rollupChatTicketHealth(tickets: readonly ChatTicketHealthInput[]): ChatTicketHealth {
  let done = 0;
  let total = 0;
  let weightedPct = 0;
  let counted = 0;
  let completedTickets = 0;
  for (const tk of tickets) {
    // A deleted ticket (`exists: false`) is removed work, not remaining work: skip it
    // exactly like a cancelled lane. (The server's `(deleted)` placeholder reports
    // status 'unknown' / progressPct 0, which would otherwise count as an open 0% ticket.)
    if (tk.exists === false) continue;
    if (isExcludedFromChatHealth(tk.status, tk.kind)) continue;
    const pct = effectiveProgressPct(tk);
    const weight = Number.isFinite(tk.total) && tk.total > 0 ? tk.total : 1;
    done += Number.isFinite(tk.done) ? tk.done : 0;
    total += weight;
    weightedPct += pct * weight;
    counted++;
    if (pct >= 100) completedTickets++;
  }
  if (counted === 0) {
    return { pct: tickets.length ? 100 : 0, done: 0, total: 0, openTickets: 0, completedTickets: 0 };
  }
  return {
    pct: Math.round(weightedPct / total),
    done,
    total,
    openTickets: counted - completedTickets,
    completedTickets,
  };
}

/**
 * A chat-progress value as every surface displays it: an integer 0–100, ROUNDED, or
 * null when there is nothing to show. One rule, so the picker, the rail and the tree
 * cannot disagree by a point over rounding.
 */
export function displayChatProgressPct(pct: unknown): number | null {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/**
 * Does a chat list row disagree with the chat's live tickets? The rail reads tickets
 * on every change. The picker and the Sessions tree read a chat-list snapshot, which
 * goes stale when a ticket moves without the list being refetched. A row that
 * carries no ticket summary at all (a host that never asked for one) is not stale.
 */
export function chatProgressIsStale(
  row: { ticketCount?: number | null; ticketProgressPct?: number | null } | undefined,
  tickets: readonly ChatTicketHealthInput[],
): boolean {
  if (!row || row.ticketCount == null) return false;
  if (row.ticketCount !== tickets.length) return true;
  if (tickets.length === 0) return false;
  return displayChatProgressPct(row.ticketProgressPct) !== rollupChatTicketHealth(tickets).pct;
}
