/**
 * VERIFIED WORK: has this run made its change AND seen it pass a check since?
 *
 * The progress detector's windows count what a stuck run never does — reach new ground,
 * move its tests. A FINISHED run stops doing those things too: its change is made, its
 * type-check passed, and what is left is wrap-up (a `git status`, a `git diff`, a ticket
 * list) before the final report. Read as a stall, that wrap-up was escalated and paused
 * for a human (VS Code chat #146477), and the escalation's forced "change tools only" turn
 * made the model invent an edit. So the detector asks this tracker first: a run with
 * verified work that trips an idle-shaped signal is told to FINISH, not to change more.
 *
 * Verified = at least one successful write this run, and a PASSING check observed after
 * the last successful write. A later write un-verifies it; a later failing check does too.
 * A finish is offered at most once per write: a run told to finish that goes idle again is
 * not finishing, and the ladder (escalate, then the third-rung finish) takes over (`finishOffered`).
 *
 * Pure; the state is plain JSON (absent fields in an older snapshot read as "no work yet").
 */

export interface VerifiedWorkState {
  /** The run has made at least one successful write. */
  wrote?: true;
  /** A passing check was observed after the last successful write. */
  verified?: true;
  /** A `finish` was already offered since the last write: the next idle trip climbs the ladder instead. */
  finishOffered?: true;
}

export class VerifiedWork {
  private wrote: boolean;
  private verified: boolean;
  private offered: boolean;

  constructor(state: VerifiedWorkState = {}) {
    this.wrote = state.wrote === true;
    this.verified = this.wrote && state.verified === true;
    this.offered = state.finishOffered === true;
  }

  /** A successful write (a file change, or a mutating command that is not a check). */
  noteWrite(): void {
    this.wrote = true;
    this.verified = false;
    this.offered = false;
  }

  /** A `finish` was offered. Until the run writes again, it is not offered twice. */
  noteFinishOffered(): void {
    this.offered = true;
  }

  /** A `finish` was already offered since the last write. */
  get finishOffered(): boolean {
    return this.offered;
  }

  /** A check answered. Only a check after a write verifies anything. */
  noteCheck(passed: boolean): void {
    if (this.wrote) this.verified = passed;
  }

  /** The run's change is made and a check passed after its last write. */
  get isVerified(): boolean {
    return this.wrote && this.verified;
  }

  snapshot(): VerifiedWorkState {
    return {
      ...(this.wrote ? { wrote: true as const } : {}),
      ...(this.isVerified ? { verified: true as const } : {}),
      ...(this.offered ? { finishOffered: true as const } : {}),
    };
  }
}
