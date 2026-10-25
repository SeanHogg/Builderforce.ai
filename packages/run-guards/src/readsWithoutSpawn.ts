/**
 * The EARLY delegation trigger (PRD 35 E5 / WS8c).
 *
 * The 2026-10-25 run was asked to "implement it using subagents", read for 77 minutes
 * and never spawned one: the undelegated-request gate only fired at a prose ending or an
 * `ask_user`, and a run that keeps reading reaches neither. This counts the read calls a
 * run makes before its first spawn, so the loop can say "stop reading, delegate" on the
 * read result itself — once, at the threshold.
 *
 * Pure; the host decides what a read and a spawn are, and whether delegation was asked
 * for. State is plain JSON so a durable host can carry it between steps.
 */

/** Read calls with no spawn before the nudge fires (`RunPolicy.delegation.readsBeforeNudge`). */
export const READS_BEFORE_DELEGATION_NUDGE = 6;

export interface ReadsWithoutSpawnState {
  /** Read calls since the run started, while no spawn had been attempted. */
  reads: number;
  /** A spawn was attempted — the counter stops for the rest of the run. */
  spawned: boolean;
  /** The nudge was given — it fires once per run. */
  nudged: boolean;
}

/** What one dispatched call was, as far as this counter cares. */
export type DelegationCallKind = "read" | "spawn" | "other";

export class ReadsWithoutSpawn {
  private state: ReadsWithoutSpawnState;

  constructor(state?: ReadsWithoutSpawnState) {
    this.state = state ? { ...state } : { reads: 0, spawned: false, nudged: false };
  }

  /** Record one dispatched call. Returns the reads-without-spawn count after it. */
  record(kind: DelegationCallKind): number {
    if (kind === "spawn") this.state.spawned = true;
    else if (kind === "read" && !this.state.spawned) this.state.reads += 1;
    return this.state.reads;
  }

  /** The threshold is reached, nothing was spawned, and the nudge has not fired yet. */
  due(threshold: number = READS_BEFORE_DELEGATION_NUDGE): boolean {
    return !this.state.spawned && !this.state.nudged && this.state.reads >= threshold;
  }

  /** The nudge was given; {@link due} stays false for the rest of the run. */
  markNudged(): void {
    this.state.nudged = true;
  }

  snapshot(): ReadsWithoutSpawnState {
    return { ...this.state };
  }
}
