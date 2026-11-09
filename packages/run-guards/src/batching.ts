/**
 * The loop-economics thresholds for the PRD 45 §4.7 B-series advisories, kept as DATA
 * beside each other so the emitters never branch on a magic number.
 */

/** B4: consecutive turns each making exactly one read-only call before the batching
 *  nudge fires. Advisory only — it never trips the ladder or any signal. */
export const SERIAL_SINGLE_CALLS_AT = 2;
