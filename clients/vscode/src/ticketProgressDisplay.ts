/**
 * Linked-ticket progress display for VSIX Sessions TreeView conversation rows.
 *
 * Contract (#2442 / #2439): `n` is `BfBrainChat.ticketProgressPct` (complete
 * percent, not remaining work and not model-context fill). The title stays the
 * chat title; the marker lives in `TreeItem.description` after relative time
 * as `{relativeTime} · {n}%`. This module is vscode-free so the clamp/format
 * rules can be unit-tested without the extension host.
 */

/** Clamp a DTO percent to an integer 0–100, or null when it cannot be shown. */
export function clampTicketProgressPct(pct: unknown): number | null {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  return Math.min(100, Math.max(0, Math.floor(pct)));
}

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
