import { displayChatProgressPct } from '@builderforce/agent-loop';
import { fill } from '../spend/format';

/**
 * A chat's linked-ticket column in the history — `62% · 3 open · 5 done` — rendered by
 * `ChatHistoryRow` itself on every row, so no host recomposes it.
 *
 * - `ticketCount` absent (a host that never asked for the rollup): no column at all —
 *   the row does not know, so it says nothing.
 * - `ticketCount` 0: one muted "No tickets", so every row has the column without a
 *   wall of zeros.
 * - open/done absent (an older server): `62% · 8 tickets` — absent is UNKNOWN, never 0.
 * - percent absent but tickets linked: `8 tickets`.
 */

/** The copy the column reads (fields of `ChatHistoryLabels`). */
export interface ChatTicketStatsLabels {
  /** "{pct}% · {open} open · {done} done". */
  ticketStats: string;
  /** Full sentence for the open/done form (title + aria-label). */
  ticketStatsAria: string;
  /** "{pct}% · {count} tickets" — open/done unknown (older server). */
  ticketStatsCount: string;
  /** Full sentence for the count form. */
  ticketStatsCountAria: string;
  /** "{count} tickets" — tickets linked, no percent. */
  ticketStatsCountOnly: string;
  /** "No tickets". */
  ticketStatsNone: string;
}

export interface ChatTicketStatsInput {
  ticketCount?: number | null;
  ticketProgressPct?: number | null;
  /** Non-cancelled tickets still below 100%. Absent on older servers. */
  ticketOpenCount?: number | null;
  /** Non-cancelled tickets at 100%. Absent on older servers. */
  ticketDoneCount?: number | null;
}

export interface ChatTicketStatsText {
  text: string;
  /** The full sentence for title / aria-label. */
  aria: string;
  /** The chat has no linked tickets (rendered muted). */
  empty: boolean;
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** The column's text, or null when the host supplied no ticket rollup for this chat. */
export function chatTicketStatsText(input: ChatTicketStatsInput, labels: ChatTicketStatsLabels): ChatTicketStatsText | null {
  if (!isCount(input.ticketCount)) return null;
  const count = input.ticketCount;
  if (count === 0) return { text: labels.ticketStatsNone, aria: labels.ticketStatsNone, empty: true };
  const pct = displayChatProgressPct(input.ticketProgressPct);
  if (pct == null) {
    const text = fill(labels.ticketStatsCountOnly, { count });
    return { text, aria: text, empty: false };
  }
  if (isCount(input.ticketOpenCount) && isCount(input.ticketDoneCount)) {
    const values = { pct, open: input.ticketOpenCount, done: input.ticketDoneCount, count };
    return { text: fill(labels.ticketStats, values), aria: fill(labels.ticketStatsAria, values), empty: false };
  }
  const values = { pct, count };
  return { text: fill(labels.ticketStatsCount, values), aria: fill(labels.ticketStatsCountAria, values), empty: false };
}

export function ChatTicketStats({ chat, labels }: { chat: ChatTicketStatsInput; labels: ChatTicketStatsLabels }) {
  const stats = chatTicketStatsText(chat, labels);
  if (!stats) return null;
  return (
    <span
      className="bf-chatrow__tickets"
      data-empty={stats.empty ? 'true' : undefined}
      title={stats.aria}
      aria-label={stats.aria}
      role="note"
    >
      {stats.text}
    </span>
  );
}
