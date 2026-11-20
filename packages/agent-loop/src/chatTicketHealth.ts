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
 * EXACT 100 IS THE ONLY COMPLETION SIGNAL, AND ONLY A CLOSED LANE MAY EMIT IT
 * A task-table ticket (task, gap, epic) whose lane is not closed (`isClosedTaskStatus`
 * false) never reads 100, whatever its raw figure says: an open epic whose filed
 * children are all done, an open task stamped `completed_at`, or an open task whose PR
 * merged reads {@link CLAIMED_COMPLETE_PROGRESS_CAP} (75) — claimed complete, not
 * closed, the same rung as `in_review`. Real work (unfiled slices, review, the close
 * itself) can still remain while the lane is open, so the ring must not say "done"
 * before the lane does (chat #276: epic in_progress with two done children read 100).
 * The cap never raises a lower figure. Conversely a CLOSED lane always reads 100, even
 * an epic closed with only 3 of 5 children done — "done" means the lane is closed.
 * A custom board's terminal lane whose key is not in `TASK_CLOSED_STATUSES` is not
 * closed to this rule: it reads 75 until the ticket moves to a closed lane.
 * The rule is {@link effectiveTicketProgress}; its PRODUCERS apply it — the server's
 * task-tier health and the rail's mapping of a task-table record — because only they
 * know a ticket's tier. Other tiers (spec, roadmap, retro, objective …) speak their own status
 * vocabulary ("complete", "shipped"), which `isClosedTaskStatus` does not know, so the
 * rule is never applied to them; the rollup below therefore averages what each producer
 * emitted and only floors a closed lane to 100 ({@link closedLaneProgress}).
 *
 * OPEN / COMPLETED TICKETS
 * `openTickets` / `completedTickets` count TICKETS (not sub-items) for the history
 * row's "3 open · 2 done" line. A ticket is completed when its effective progress is
 * at least 100, which for a task-table ticket means its lane is closed. Cancelled
 * tickets count as neither. open = counted − completed, so an empty or all-cancelled
 * list is 0 / 0.
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
}

/**
 * Ceiling for a task-table ticket whose raw progress reads complete while its lane is
 * still open. Same rung as `in_review` on the status ladder: claimed complete, not
 * closed. Exact 100 is the only completion signal and only a closed lane may emit it.
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

/** True when this lane must not sit in the chat-health denominator. */
export function isExcludedFromChatHealth(status?: string | null): boolean {
  return isCancelledTaskStatus(status);
}

/**
 * The closed-lane half of the rule, for ANY tier: a closed lane IS complete by
 * definition — the status ladder is authoritative once closed — so a stale, partial or
 * demoted record percent never wins; the lane reads 100. This is the contract behind a
 * chip that shows DONE beside its ring: the badge (status) and the ring (percent) cannot
 * disagree, on the server, in the web panel and in the VS Code rail alike.
 *
 * An open lane passes its raw percent through: this half never caps, so it is safe for
 * a tier whose status vocabulary is not the task lanes'.
 */
export function closedLaneProgress(
  status: string | null | undefined,
  progressPct: number | null | undefined,
): number {
  const raw = typeof progressPct === "number" && Number.isFinite(progressPct) ? progressPct : 0;
  return isClosedTaskStatus(status) ? Math.max(raw, 100) : raw;
}

/**
 * The ONE "what does a task-table ticket's progress read" rule, shared by the server's
 * task tier (`buildTaskProgressBreakdown`, `taskTierTicketHealth`) and the rail
 * (`railTicketProgress`, for task/gap/epic records).
 *
 * Exact 100 is the only completion signal, and only a closed lane may emit it: a closed
 * lane reads 100 ({@link closedLaneProgress}); an open lane whose raw progress is 100 or
 * more reads {@link CLAIMED_COMPLETE_PROGRESS_CAP}; the cap never raises a lower figure.
 */
export function effectiveTicketProgress(
  status: string | null | undefined,
  progressPct: number | null | undefined,
): number {
  const pct = closedLaneProgress(status, progressPct);
  if (!isClosedTaskStatus(status) && pct >= 100) return CLAIMED_COMPLETE_PROGRESS_CAP;
  return pct;
}

function effectiveProgressPct(t: ChatTicketHealthInput): number {
  // The rollup sees every tier, so it applies only the closed-lane half (a closed lane is
  // 100); each task-table producer has already applied the open-lane cap (module comment).
  return closedLaneProgress(t.status, t.progressPct);
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
