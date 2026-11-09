/**
 * Linked-ticket progress display for VSIX Sessions TreeView conversation rows.
 *
 * Contract (#2442 / #2439): `n` is `BfBrainChat.ticketProgressPct` (complete
 * percent, not remaining work and not model-context fill). The title stays the
 * chat title; the marker lives in `TreeItem.description` after relative time
 * as `{relativeTime} · {n}%`. The percent itself goes through agent-loop's
 * `displayChatProgressPct`, the rounding rule the picker and the ticket rail use.
 * This module is vscode-free so the format rules can be unit-tested without the
 * extension host.
 */

/** TreeItem.label: chat title only. Never `{n}% · {title}`. */
export function conversationTreeLabel(chat: { id: number; title?: string | null }): string {
  return chat.title || `Chat ${chat.id}`;
}

/** A chat's non-cancelled linked tickets split by state. Absent (older server) = unknown, never 0. */
export interface TicketCounts {
  open?: number | null;
  done?: number | null;
}

/** The open/done copy — the host passes `vscode.l10n` labels; the English default keeps this vscode-free. */
export interface TicketCountLabels {
  open: (n: number) => string;
  done: (n: number) => string;
}

export const DEFAULT_TICKET_COUNT_LABELS: TicketCountLabels = {
  open: (n) => `${n} open`,
  done: (n) => `${n} done`,
};

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * Append ` · {n}%` after the relative time when a percent is present, then
 * ` · {open} open · {done} done` when BOTH counts are known (the same column the
 * shared chat-history row shows). Empty time + a percent yields `{n}%` (no
 * dangling ` · `). Absent percent returns the time unchanged — including the
 * empty string — and never shows counts on their own.
 */
export function appendTicketProgress(
  relativeTime: string,
  pct: number | null,
  counts?: TicketCounts,
  labels: TicketCountLabels = DEFAULT_TICKET_COUNT_LABELS,
): string {
  if (pct == null) return relativeTime;
  const parts = relativeTime ? [relativeTime, `${pct}%`] : [`${pct}%`];
  if (counts && isCount(counts.open) && isCount(counts.done)) {
    parts.push(labels.open(counts.open), labels.done(counts.done));
  }
  return parts.join(" · ");
}

/** Tooltip-only wording. The row itself never says "ticket progress" or "context". */
export function ticketProgressTooltipLine(pct: number): string {
  return `Ticket progress: ${pct}%`;
}

/**
 * Accessible name: `{title}, {relativeTime}, {n} percent ticket progress`
 * when shown; `{title}, {relativeTime}` when not. Empty time is omitted.
 */
export function conversationAccessibilityName(
  title: string,
  relativeTime: string,
  pct: number | null,
): string {
  const parts = [title];
  if (relativeTime) parts.push(relativeTime);
  if (pct != null) parts.push(`${pct} percent ticket progress`);
  return parts.join(", ");
}
