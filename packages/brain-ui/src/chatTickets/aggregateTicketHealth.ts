/**
 * Rolls a chat's linked tickets up into the single health figure shown on the
 * ChatTicketsPanel header (the collapsed ring, e.g. "3 tickets · 67% · 0/3").
 *
 * WHY THIS IS NOT Σdone / Σtotal
 * ------------------------------
 * `done`/`total` on a {@link TicketLinkVM} are a COUNT OF COMPLETED ITEMS, not a
 * measure of progress. A leaf task reports `total: 1` and `done: 1` only once it
 * actually reaches a done status — so a task sitting in review is `done: 0,
 * total: 1` even though its own ring reads 75%.
 *
 * Aggregating Σdone/Σtotal therefore discards every partial contribution. For a
 * flat list of leaf tasks it can only ever yield 0% or 100%, which is how the
 * header came to read "0% · 0/3" while the three rings beside it read 75, 50 and
 * 75 — the summary contradicted the tickets it was summarising.
 *
 * `progressPct` IS the authoritative progress signal (it is what each per-ticket
 * ring renders), so the headline aggregates that instead, weighting each ticket
 * by its `total` so a ten-child epic outweighs a single leaf task.
 *
 * A ticket that reports `total: 0` still counts as weight 1. Incomplete
 * spec/roadmap/retro used to emit `total: done ? 1 : 0`, so a 0% ring had no
 * weight and vanished from the headline — "100% · 4/4" beside six chips, two
 * of them empty. Deleted tickets (`total: 0`, `progressPct: 0`) have the same
 * shape. Counting them as one item keeps the header honest against the rings.
 *
 * `done`/`total` are still returned so the caller can show the item counter
 * alongside — "4 of 6 complete" is separately true, and useful.
 */
export interface TicketHealthInput {
  /** Authoritative progress for this ticket, 0–100. */
  progressPct: number;
  /** Completed sub-items (a leaf task is 0 or 1). */
  done: number;
  /** Total sub-items (a leaf task is 1). */
  total: number;
}

export interface AggregateTicketHealth {
  /** Overall progress 0–100 for the header ring. */
  pct: number;
  /** Total completed items across all tickets. */
  done: number;
  /** Total items across all tickets. */
  total: number;
}

export function aggregateTicketHealth(tickets: readonly TicketHealthInput[]): AggregateTicketHealth {
  let done = 0;
  let total = 0;
  let weightedPct = 0;

  for (const tk of tickets) {
    const pct = Number.isFinite(tk.progressPct) ? tk.progressPct : 0;
    // Weight 1 when the server omitted a denominator (legacy spec/roadmap/retro
    // `total: 0`, deleted items) so a 0% ring still pulls the headline down.
    const weight = Number.isFinite(tk.total) && tk.total > 0 ? tk.total : 1;
    done += Number.isFinite(tk.done) ? tk.done : 0;
    total += weight;
    weightedPct += pct * weight;
  }

  const pct = tickets.length ? Math.round(weightedPct / total) : 0;

  return { pct, done, total };
}
