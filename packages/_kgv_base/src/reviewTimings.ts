/**
 * The two waits of Stop, in ONE place so they can never disagree. The host gets `ABORT_GRACE_MS` after Stop to send its terminal event before the review lets go
 * by itself; the panel offers Force stop after `STUCK_AFTER_MS`, which is clearly shorter, so the person is never stuck waiting for the grace to run out.
 */

/** How long, after Stop, the review waits for the host's terminal event before letting go. */
export const ABORT_GRACE_MS = 30_000;

/** How long after Stop, with no word from the host, the panel says so and offers Force stop. Always well under {@link ABORT_GRACE_MS}. */
export const STUCK_AFTER_MS = 10_000;
