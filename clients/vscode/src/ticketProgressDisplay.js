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
export function conversationTreeLabel(chat) {
    return chat.title || `Chat ${chat.id}`;
}
export const DEFAULT_TICKET_COUNT_LABELS = {
    open: (n) => `${n} open`,
    done: (n) => `${n} done`,
};
const isCount = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
/**
 * Append ` · {n}%` after the relative time when a percent is present, then
 * ` · {open} open · {done} done` when BOTH counts are known (the same column the
 * shared chat-history row shows). Empty time + a percent yields `{n}%` (no
 * dangling ` · `). Absent percent returns the time unchanged — including the
 * empty string — and never shows counts on their own.
 */
export function appendTicketProgress(relativeTime, pct, counts, labels = DEFAULT_TICKET_COUNT_LABELS) {
    if (pct == null)
        return relativeTime;
    const parts = relativeTime ? [relativeTime, `${pct}%`] : [`${pct}%`];
    if (counts && isCount(counts.open) && isCount(counts.done)) {
        parts.push(labels.open(counts.open), labels.done(counts.done));
    }
    return parts.join(" · ");
}
/** Tooltip-only wording. The row itself never says "ticket progress" or "context". */
export function ticketProgressTooltipLine(pct) {
    return `Ticket progress: ${pct}%`;
}
/**
 * Accessible name: `{title}, {relativeTime}, {n} percent ticket progress`
 * when shown; `{title}, {relativeTime}` when not. Empty time is omitted.
 */
export function conversationAccessibilityName(title, relativeTime, pct) {
    const parts = [title];
    if (relativeTime)
        parts.push(relativeTime);
    if (pct != null)
        parts.push(`${pct} percent ticket progress`);
    return parts.join(", ");
}
//# sourceMappingURL=ticketProgressDisplay.js.map