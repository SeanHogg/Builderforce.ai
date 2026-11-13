/**
 * The auto-continue no-progress guard. Chat #80006 ran 24 times and closed nothing:
 * runs #2–#24 kept auto-continuing with an empty ask, each restart re-reading the same
 * files. This module caps that: after {@link MAX_NO_PROGRESS_CONTINUATIONS} continuation
 * runs in a row that changed no file and passed no check, the chain stops and the run
 * settles with ONE honest status line instead of starting run N+1.
 *
 * Reuses the run's own evidence verdict (`verificationOf`) and its touched-file list —
 * no new progress heuristic. Pure per chat; state is one counter reset by every
 * person's turn (`noteContinuationProgress`) and by a run that actually progressed.
 */

/** Consecutive no-progress continuation runs before the auto-continue chain stops. */
export const MAX_NO_PROGRESS_CONTINUATIONS = 3;

/** Per-chat streak of consecutive continuation runs that made no progress. */
const streaks = new Map<number, number>();

/** Forget every streak (`resetBrainRunStore`: tests, teardown). */
export function resetContinuationProgress(): void {
  streaks.clear();
}

/** A person's turn starts the chain over: their words may continue freely again. */
export function notePersonTurn(runKey: number): void {
  streaks.delete(runKey);
}

/** Whether the auto-continue chain may start another continuation run. */
export function mayAutoContinue(runKey: number): boolean {
  return (streaks.get(runKey) ?? 0) < MAX_NO_PROGRESS_CONTINUATIONS;
}

/**
 * Record one settled continuation run's progress. `progressed` is true when the run
 * changed a file or gained a passing check. Returns the new streak.
 */
export function noteContinuationProgress(runKey: number, progressed: boolean): number {
  const next = progressed ? 0 : (streaks.get(runKey) ?? 0) + 1;
  streaks.set(runKey, next);
  return next;
}

/** The streak for a chat (the diagnostics' Runs line reads it). */
export function continuationStreakOf(runKey: number): number {
  return streaks.get(runKey) ?? 0;
}
