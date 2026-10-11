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

/**
 * Append ` · {n}%` after the relative time when a percent is present.
 * Empty time + a percent yields `{n}%` (no dangling ` · `). Absent percent
 * returns the time unchanged — including the empty string.
 */
export function appendTicketProgress(relativeTime: string, pct: number | null): string {
  if (pct == null) return relativeTime;
  return relativeTime ? `${relativeTime} · ${pct}%` : `${pct}%`;
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
