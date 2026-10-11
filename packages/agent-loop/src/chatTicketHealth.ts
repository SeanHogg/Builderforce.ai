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
 * - Cancelled is terminal but not done-class (`progressPct: 0`). Averaging it in made
 *   "3 done + 1 cancelled" read as 75%, so cancelled tickets are skipped. US `canceled`
 *   too. An all-cancelled list is 100% (nothing owed). An empty list is 0%.
 * - `done`/`total` are still returned for the "4/6" counter beside the percent.
 */

export interface ChatTicketHealthInput {
  /** Authoritative progress for this ticket, 0–100. */
  progressPct: number;
  /** Completed sub-items (a leaf task is 0 or 1). */
  done: number;
  /** Total sub-items (a leaf task is 1). */
  total: number;
  /** Lane key. Cancelled work is skipped — it is off the board, not remaining. */
  status?: string | null;
}

export interface ChatTicketHealth {
  /** Overall progress 0–100. */
  pct: number;
  /** Completed items across the counted tickets. */
  done: number;
  /** Items across the counted tickets. */
  total: number;
}

/** True when this lane must not sit in the chat-health denominator. */
export function isExcludedFromChatHealth(status?: string | null): boolean {
  const s = (status ?? "").trim().toLowerCase();
  return s === "cancelled" || s === "canceled";
}

/** Roll a chat's linked tickets up into its one progress figure. */
export function rollupChatTicketHealth(tickets: readonly ChatTicketHealthInput[]): ChatTicketHealth {
  let done = 0;
  let total = 0;
  let weightedPct = 0;
  let counted = 0;
  for (const tk of tickets) {
    if (isExcludedFromChatHealth(tk.status)) continue;
    const pct = Number.isFinite(tk.progressPct) ? tk.progressPct : 0;
    const weight = Number.isFinite(tk.total) && tk.total > 0 ? tk.total : 1;
    done += Number.isFinite(tk.done) ? tk.done : 0;
    total += weight;
    weightedPct += pct * weight;
    counted++;
  }
  if (counted === 0) return { pct: tickets.length ? 100 : 0, done: 0, total: 0 };
  return { pct: Math.round(weightedPct / total), done, total };
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
