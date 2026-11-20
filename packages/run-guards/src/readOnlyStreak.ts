/**
 * The READ-ONLY STREAK: a run that keeps reading NEW files, turn after turn, and never acts.
 *
 * Every other window lets that run through. `noProgress.ts` counts each new file or offset
 * as ground progress, `unkept_ready` (`readinessClaim.ts`) needs the run to SAY it has what
 * it needs, and the batching nudge only sees single-call turns. VSIX chat #132309 run #3
 * made 14 turns of 3–4 reads of new files each (46 calls, 0 changes), narrating "I'll read
 * X and fix them" every turn, and no steer ever fired. So this counts what that run never
 * does — ACT: a turn whose calls were ALL read-only extends the streak; a turn with any
 * other call (an edit, a write, a delete, a command, a spawn, a hand-off, a question, a
 * task) resets it, and so does a turn with no calls at all (a final answer).
 *
 * Pure: no I/O, no clock; the state is plain JSON.
 */

/** All-read-only turns in a row that trip `read_only_streak`. */
export const READ_ONLY_STREAK_TURNS = 6;

/** Read-only calls in a row (across those turns) that trip it, however few the turns. */
export const READ_ONLY_STREAK_CALLS = 18;

/** The streak's plain-JSON state, carried in the durable loop snapshot. */
export interface ReadOnlyStreakState {
  /** Consecutive turns whose calls were all read-only. */
  turns: number;
  /** Read-only calls across those turns. */
  calls: number;
}

export class ReadOnlyStreak {
  private turns: number;
  private calls: number;
  private turnCalls = 0;
  private neutralCalls = 0;
  private acted = false;

  constructor(state?: ReadOnlyStreakState) {
    this.turns = state?.turns ?? 0;
    this.calls = state?.calls ?? 0;
  }

  /** One call of the current turn. `readOnly` = it only read. */
  observe(readOnly: boolean): void {
    this.turnCalls += 1;
    if (!readOnly) this.acted = true;
  }

  /** One call of the current turn that is neither a read nor an act — a wait on work still
   *  running elsewhere. A turn of only such calls leaves the streak as it was. */
  observeNeutral(): void {
    this.neutralCalls += 1;
  }

  /** The turn's calls all ran. Returns the streak after it. */
  endTurn(): ReadOnlyStreakState {
    // A turn of only waits neither extends nor breaks the streak.
    const onlyWaits = !this.acted && this.turnCalls === 0 && this.neutralCalls > 0;
    if (!onlyWaits && (this.acted || this.turnCalls === 0)) {
      this.turns = 0;
      this.calls = 0;
    } else if (!onlyWaits) {
      this.turns += 1;
      this.calls += this.turnCalls;
    }
    this.turnCalls = 0;
    this.neutralCalls = 0;
    this.acted = false;
    return { turns: this.turns, calls: this.calls };
  }

  /** Start over (a trip, a steer, a human). */
  reset(): void {
    this.turns = 0;
    this.calls = 0;
  }

  snapshot(): ReadOnlyStreakState {
    return { turns: this.turns, calls: this.calls };
  }
}
