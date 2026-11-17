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
 * OPEN / COMPLETED TICKETS
 * `openTickets` / `completedTickets` count TICKETS (not sub-items) for the history
 * row's "3 open · 2 done" line. A ticket is completed when its effective progress is
 * at least 100. The unsupported-delivery cap can keep a pre-close "done-claim" below
 * 100, but once the lane itself is closed the ticket is complete and counts as done.
 * Cancelled tickets count as neither. open = counted − completed, so an
 * empty or all-cancelled list is 0 / 0.
 */

import { isCancelledTaskStatus, isClosedTaskStatus } from "./taskClosedState.js";

export interface ChatTicketHealthInput {
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
  /**
   * The reported `progressPct` is not backed by delivery evidence. Lowers a 100
   * to {@link UNSUPPORTED_DELIVERY_PROGRESS_CAP}; never raises a lower figure.
   */
  unsupportedDelivery?: boolean;
}

/**
 * Ceiling for a ticket whose children (or own status) read complete, but a live
 * execution exists and no coder run left a non-documentation file. Same rung as
 * `in_review` on the status ladder: claimed done, not verified by delivery.
 * Exact 100 remains the only completion signal — this cap exists so a
 * documentation-only close cannot emit it.
 */
export const UNSUPPORTED_DELIVERY_PROGRESS_CAP = 75;

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

/** True when this lane must not sit in the chat-health denominator. */
export function isExcludedFromChatHealth(status?: string | null): boolean {
  return isCancelledTaskStatus(status);
}

/**
 * The ONE "what does this ticket's progress read" rule, shared by the rail
 * (`railTicketProgress`), the server's epic branch (taskTierTicketHealth), and
 * this rollup.
 *
 * The unsupported-delivery cap applies only BEFORE the lane closes and only to a
 * claimed-complete ticket: an open ticket whose raw progress is 100 but whose
 * delivery is unsupported reads the cap rung (75); the cap never raises a lower
 * figure. A closed (done) lane is handled by `whenClosed`, because "closed" means
 * two different things to the two consumers of this rule:
 *
 * - `'passthrough'` (the default — the rollup and the server's epic branch): a
 *   done lane passes its raw percent through unchanged. Delivery evidence only
 *   CAPS a claimed-complete ticket; it never floors one, so a done ticket still
 *   carrying a pre-close capped percent (75) reads 75 until the record refreshes.
 * - `'complete'` (the rail / every UI surface): a done lane IS complete by
 *   definition — the status ladder is authoritative once closed — so a stale or
 *   demoted record percent must never win; the lane reads 100. This is the
 *   UI/UX contract behind a chip that shows DONE beside a 75% ring: the badge
 *   (status) and the ring (percent) cannot disagree.
 */
export function effectiveTicketProgress(
  status: string | null | undefined,
  progressPct: number | null | undefined,
  unsupportedDelivery?: boolean,
  whenClosed: "passthrough" | "complete" = "passthrough",
): number {
  const raw = typeof progressPct === "number" && Number.isFinite(progressPct) ? progressPct : 0;
  if (isClosedTaskStatus(status)) {
    return whenClosed === "complete" ? Math.max(raw, 100) : raw;
  }
  if (unsupportedDelivery === true && raw >= 100) return UNSUPPORTED_DELIVERY_PROGRESS_CAP;
  return raw;
}

function effectiveProgressPct(t: ChatTicketHealthInput): number {
  return effectiveTicketProgress(t.status, t.progressPct, t.unsupportedDelivery);
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
    if (isExcludedFromChatHealth(tk.status)) continue;
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
