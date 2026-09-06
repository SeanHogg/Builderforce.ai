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
 * by its `total` so a ten-child epic outweighs a single leaf task. When no ticket
 * reports sub-items, weights are meaningless and an unweighted mean is used.
 *
 * `done`/`total` are still returned so the caller can show the item counter
 * alongside — "0 of 3 complete" is separately true, and useful.
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
  let sumPct = 0;
  let weightedPct = 0;

  for (const tk of tickets) {
    const pct = Number.isFinite(tk.progressPct) ? tk.progressPct : 0;
    const weight = Number.isFinite(tk.total) && tk.total > 0 ? tk.total : 0;
    done += Number.isFinite(tk.done) ? tk.done : 0;
    total += weight;
    sumPct += pct;
    weightedPct += pct * weight;
  }

  const pct = total > 0
    ? Math.round(weightedPct / total)
    : tickets.length
      ? Math.round(sumPct / tickets.length)
      : 0;

  return { pct, done, total };
}
