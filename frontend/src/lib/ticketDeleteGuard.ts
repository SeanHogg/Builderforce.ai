/**
 * Gate for deleting a board ticket. A live execution must be stopped first —
 * deleting under a running/queued/pending agent orphans the run.
 */

export type TicketDeleteGate = "stop-execution" | "confirm";

export function ticketDeleteGate(
  runs: ReadonlyArray<{ status: string }>,
  active: ReadonlySet<string>,
): TicketDeleteGate {
  return runs.some((r) => active.has(r.status)) ? "stop-execution" : "confirm";
}
