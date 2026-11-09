/**
 * The EARLY READINESS STEER (PRD 45 §4.7 B1): the run declared it has what it needs
 * ("Now I have everything I need", "one final check, then I write") and then only read.
 * {@link UNKEPT_READY_AT} claims still make a TRIP (the pause/escalate ladder), but one
 * unkept claim is already worth a one-off note on the NEXT turn — the model is one
 * read-only turn away from acting, and a gentle "make the edit now" arrives a full
 * {@link UNKEPT_READY_AT} turns earlier than the ladder's first steer.
 *
 * The threshold stays DATA ({@link UNKEPT_STEER_AT}, beside {@link UNKEPT_READY_AT}) —
 * the emitter never branches on a magic number. The advisory NEVER trips the ladder and
 * never counts toward {@link ProgressDetectorState.tripsBySignal}.
 *
 * Pure; the state is plain JSON.
 */

import { UNKEPT_STEER_AT } from "./readinessClaim.js";

// Re-exported: the advisory's threshold is data defined beside UNKEPT_READY_AT, and
// consumers (the package index, the B1 tests) read both from this module.
export { UNKEPT_STEER_AT };

/** The advisory note, shown on exactly one following turn ("" when none). */
export interface ReadinessAdvisoryState {
  note: string;
  /** The one shot has been spent — plain JSON so a durable resume never re-fires it. */
  fired?: boolean;
}

/** The one-off note. One sentence, pointing at the edit, naming the lever it rides. */
export const READINESS_ADVISORY_NOTE =
  "You said you have what you need. Make the edit now; read only files you will change.";

export class ReadinessAdvisory {
  private note: string;
  private fired: boolean;

  constructor(state?: ReadinessAdvisoryState) {
    this.note = state?.note ?? "";
    this.fired = state?.fired ?? false;
  }

  /**
   * `unkeptTotal` — every unkept claim this run, from the detector's trip-invariant
   * counter (never reset by a trip). The advisory fires exactly once per run: the first
   * time the total reaches {@link UNKEPT_STEER_AT}; a reset streak cannot re-trigger it
   * because `fired` persists in the JSON snapshot. Returns the pending note ("" when
   * none or already consumed by {@link endTurn}).
   */
  observe(unkeptTotal: number): string {
    if (!this.fired && unkeptTotal >= UNKEPT_STEER_AT) {
      this.fired = true;
      this.note = READINESS_ADVISORY_NOTE;
    }
    return this.note;
  }

  /** The pending note has now been shown for its one turn — consume it (the one-shot
   *  `fired` flag is NOT cleared, so it never re-fires). */
  endTurn(): void {
    this.note = "";
  }

  snapshot(): ReadinessAdvisoryState {
    return { note: this.note, ...(this.fired ? { fired: true } : {}) };
  }
}
