/**
 * Filtering and paging over a chat's RESOLVED ticket links — the page behind
 * `chats.list_tickets` and {@link ChatTicketService.listTicketPageForChat}.
 *
 * A chat can carry 100+ links, and an unfiltered array is both an over-long tool
 * payload and an unusable answer: an agent asking "which tickets on this chat are
 * still open?" had to page a long array and classify every row itself, which is
 * how tickets got missed and the board drifted. This module answers that with
 * `openOnly` / `status` / `kind` filters plus `limit` / `offset`, and ALWAYS
 * returns the {@link ChatTicketPage} envelope so a truncated page is
 * self-describing (`matched` / `hasMore`).
 *
 * Filtering runs AFTER the health batch because `status` / `progressPct` are
 * derived live from each ticket's own subtasks — not columns on the link row — so
 * one batch serves the chat regardless of how many filters were passed.
 *
 * Pure: no I/O, so the rules are testable without a database.
 */
import { TASK_CLOSED_STATUSES } from '@builderforce/agent-loop';
import type { ChatTicketLink } from './ChatTicketService';

/** One page of a chat's linked tickets. */
export interface ChatTicketPage {
  /** The page's tickets, in link-creation order. */
  tickets: ChatTicketLink[];
  /** Links on this chat BEFORE filtering and paging — the denominator. */
  total: number;
  /** How many links matched the filters (not just those in this page). */
  matched: number;
  /** True when `matched` exceeds what this page returned. */
  hasMore: boolean;
}

/** Filter/paging for {@link ChatTicketService.listTicketPageForChat}. */
export interface ListChatTicketsOptions {
  /** Keep only links whose resolved health `status` equals this (case-insensitive). */
  status?: string;
  /** Keep only one tier, e.g. 'task' or 'epic'. */
  kind?: string;
  /**
   * Keep only work still owed — anything not in the closed class. A link whose
   * target no longer exists is KEPT: a deleted ticket is unresolved, not done,
   * so it stays visible rather than silently disappearing from the open set.
   */
  openOnly?: boolean;
  /** Max tickets to return. Undefined (or not a finite number) = all matches. */
  limit?: number;
  /** Skip this many matches. Undefined, negative or not finite = 0. */
  offset?: number;
}

/** Upper bound on `limit`, so one chat cannot ask for an unbounded payload. */
export const MAX_CHAT_TICKET_PAGE = 500;

/** The shared closed class — the same one health uses, so "open" never disagrees
 *  with what the progress chip reports. */
const CLOSED_STATUS: ReadonlySet<string> = new Set(TASK_CLOSED_STATUSES);

/**
 * Apply the list filters. `openOnly` is deliberately not `progressPct < 100`: an
 * in_progress item reads 50 and a backlog item 0, both open, and a container that
 * is merely PART complete is open too. A link whose target no longer exists is
 * treated as OPEN — dropping it would let the board look cleaner than it is.
 */
export function filterChatTickets(rows: readonly ChatTicketLink[], options: ListChatTicketsOptions): ChatTicketLink[] {
  const status = options.status?.trim().toLowerCase();
  const kind = options.kind?.trim().toLowerCase();
  return rows.filter((r) => {
    if (status && r.status.toLowerCase() !== status) return false;
    if (kind && r.kind.toLowerCase() !== kind) return false;
    if (options.openOnly && r.exists && CLOSED_STATUS.has(r.status.toLowerCase())) return false;
    return true;
  });
}

/** A finite integer, or undefined — `NaN` / `Infinity` from a malformed tool arg
 *  must not reach `slice` (a NaN offset slices nothing; a NaN limit returns nothing). */
function finiteInt(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

/** Slice the filtered rows into the envelope. Always the envelope — never a bare array. */
export function pageChatTickets(
  filtered: readonly ChatTicketLink[],
  total: number,
  options: ListChatTicketsOptions,
): ChatTicketPage {
  const offset = Math.max(0, finiteInt(options.offset) ?? 0);
  const rawLimit = finiteInt(options.limit);
  const limit = rawLimit == null ? undefined : Math.max(1, Math.min(rawLimit, MAX_CHAT_TICKET_PAGE));
  const tickets = limit == null ? filtered.slice(offset) : filtered.slice(offset, offset + limit);
  return { tickets, total, matched: filtered.length, hasMore: offset + tickets.length < filtered.length };
}

/** Filter then page a chat's resolved links; `rows.length` is the `total`. */
export function chatTicketPage(rows: readonly ChatTicketLink[], options: ListChatTicketsOptions): ChatTicketPage {
  return pageChatTickets(filterChatTickets(rows, options), rows.length, options);
}
