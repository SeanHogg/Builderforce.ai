/**
 * Presentational order of the chat ticket rail.
 *
 * The adapter returns tickets in link/API order. The grid reorders that list so
 * incomplete work is not buried under DONE chips — the default the VSIX, web
 * Brain, and Rovr all share. Changing the rail's <select> only changes what is
 * painted; it does not rewrite links.
 */

export const CHAT_TICKET_SORTS = ['open', 'done', 'title', 'linked'] as const;
export type ChatTicketSort = (typeof CHAT_TICKET_SORTS)[number];

/** A ticket is complete when its health ring reads 100% — same rule the ring paints. */
export function isChatTicketComplete(progressPct: number): boolean {
  return progressPct === 100;
}

export function parseChatTicketSort(value: string): ChatTicketSort {
  return (CHAT_TICKET_SORTS as readonly string[]).includes(value)
    ? (value as ChatTicketSort)
    : 'open';
}

export interface SortableChatTicket {
  progressPct: number;
  label: string;
}

/**
 * `open` (default): incomplete first, then lower progress, then title.
 * `done`: complete first, then higher progress, then title.
 * `title`: A–Z by label.
 * `linked`: the adapter's order, unchanged.
 */
export function sortChatTickets<T extends SortableChatTicket>(
  tickets: readonly T[],
  sort: ChatTicketSort,
): T[] {
  if (sort === 'linked' || tickets.length < 2) return tickets.slice();
  const copy = tickets.slice();
  copy.sort((a, b) => {
    if (sort === 'title') return a.label.localeCompare(b.label);
    const aDone = isChatTicketComplete(a.progressPct) ? 1 : 0;
    const bDone = isChatTicketComplete(b.progressPct) ? 1 : 0;
    if (sort === 'open') {
      if (aDone !== bDone) return aDone - bDone;
      if (a.progressPct !== b.progressPct) return a.progressPct - b.progressPct;
      return a.label.localeCompare(b.label);
    }
    if (aDone !== bDone) return bDone - aDone;
    if (a.progressPct !== b.progressPct) return b.progressPct - a.progressPct;
    return a.label.localeCompare(b.label);
  });
  return copy;
}
