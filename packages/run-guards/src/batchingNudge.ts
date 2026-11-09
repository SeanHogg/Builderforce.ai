/**
 * The BATCHING NUDGE (PRD 45 §4.7 B4): two consecutive turns that EACH made exactly one
 * read-only call are serialising what independent reads could have been one batched
 * call (`edit_file`'s `edits` array, one `run_command` that runs the checks together).
 * The note lands on the NEXT turn as advice — it NEVER trips the ladder, never touches
 * {@link UNKEPT_READY_AT} or any other signal, and the turn with a write in it resets
 * the count because a write is real progress, not serial reading.
 *
 * The threshold stays DATA ({@link SERIAL_SINGLE_CALLS_AT}, beside the other
 * loop-economics thresholds) — the detector never branches on a magic number. The
 * count is of CONSECUTIVE single-readonly turns, so one busy turn breaks the streak.
 *
 * Pure; the state is plain JSON.
 */

import { SERIAL_SINGLE_CALLS_AT } from "./batching.js";
import type { ObservedResult } from "./progressDetector.js";

// Re-exported: the threshold is data defined beside the other loop-economics thresholds.
export { SERIAL_SINGLE_CALLS_AT };

/** The batching nudge's plain-JSON state, carried in the durable loop snapshot. */
export interface BatchingNudgeState {
  /** Consecutive turns that each made exactly one read-only call. */
  streak: number;
  /** The one note has been shown — plain JSON so a durable resume never re-fires it. */
  fired?: boolean;
}

/** The one sentence the next turn sees. */
export const BATCHING_NUDGE_NOTE =
  "You have made one read-only call per turn for several turns. When the calls are independent, batch them into one: use the `edit_file` `edits` array for several edits, or one `run_command` that runs the checks together.";

export class BatchingNudge {
  private streak: number;
  private fired: boolean;

  constructor(state?: BatchingNudgeState) {
    this.streak = state?.streak ?? 0;
    this.fired = state?.fired ?? false;
  }

  /**
   * `turnCalls` — every call of the turn that just ended, with whether each was
   * read-only. Exactly one read-only call (and no other call) extends the streak;
   * anything else — a write, two or more calls, or zero calls — resets it, because
   * that turn was real work, not serial reading. When the streak reaches
   * {@link SERIAL_SINGLE_CALLS_AT} and the note has not fired this run yet, the note
   * is produced (once — `fired` persists in the JSON snapshot, so a resume never
   * re-fires it). Returns the pending note ("" when none).
   */
  observe(turnCalls: ReadonlyArray<{ readOnly: boolean }>): string {
    const singleReadOnly =
      turnCalls.length === 1 && turnCalls[0]?.readOnly === true;
    this.streak = singleReadOnly ? this.streak + 1 : 0;
    if (!this.fired && this.streak >= SERIAL_SINGLE_CALLS_AT) {
      this.fired = true;
      return BATCHING_NUDGE_NOTE;
    }
    return "";
  }

  snapshot(): BatchingNudgeState {
    return { streak: this.streak, ...(this.fired ? { fired: true } : {}) };
  }
}

/** Pure helper the detector uses to shape its per-turn calls for {@link BatchingNudge.observe}. */
export function turnCallsOf(
  calls: ReadonlyArray<{ tool: string; args: unknown; result: ObservedResult }>,
  isReadOnly?: (tool: string, args: unknown) => boolean,
): Array<{ readOnly: boolean }> {
  return calls.map((c) => ({ readOnly: isReadOnly?.(c.tool, c.args) === true }));
}
