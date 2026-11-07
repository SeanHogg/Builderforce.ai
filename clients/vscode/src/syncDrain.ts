/**
 * Drain a sync partition: one `coordinator.synchronize` pushes ONE batch (≤100 events /
 * 512 KB), so a program of tickets bigger than a batch needs more rounds. Keep going
 * while events bound to the destination remain pending AND the last round made progress
 * (events accepted or answered duplicate, or the pending count fell). The hard cap keeps
 * `dependency_pending` / dead-lettered events from spinning the pass — they wait for the
 * next trigger or the heartbeat instead.
 */

/** The part of a coordinator's round summary the drain reads. */
export interface DrainRound {
  pushed: number;
  duplicates: number;
}

export const MAX_DRAIN_ROUNDS = 20;

export interface DrainPorts {
  /** One `coordinator.synchronize(destination)`. */
  round(): Promise<DrainRound | undefined>;
  /** Events still pending for the destination. */
  pending(): Promise<number>;
}

/** Run rounds until nothing is pending, a round makes no progress, or the cap. Returns the rounds run. */
export async function drainSync(ports: DrainPorts, maxRounds: number = MAX_DRAIN_ROUNDS): Promise<number> {
  let rounds = 0;
  let before = await ports.pending();
  while (rounds < maxRounds) {
    const summary = await ports.round();
    rounds += 1;
    if (!summary) break; // the lease is held elsewhere: that holder drains
    const after = await ports.pending();
    if (after === 0) break;
    const progressed = summary.pushed + summary.duplicates > 0 || after < before;
    if (!progressed) break;
    before = after;
  }
  return rounds;
}
