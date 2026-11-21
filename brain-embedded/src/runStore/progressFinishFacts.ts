/**
 * The progress guard's (`progressGuard.ts`) trace label and finish shape as plain data, so the diagnostics readers
 * (`toolExposure.ts`, `routingByRole.ts`) read the same facts the guard writes without importing the guard and its runtime.
 */

/** The trace label of a turn the progress guard forced (`args.forced`: 'hand_off' | 'change' | 'finish'). */
export const PROGRESS_FORCED_LABEL = 'loop.progress_forced';

/** Turns a finishing run may spend recording its remaining work as tickets, the finish turn itself included. */
export const FINISH_RECORD_TURNS = 3;
