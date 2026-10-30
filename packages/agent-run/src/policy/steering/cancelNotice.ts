/**
 * The notice a cancelled run is closed out with when it produced no output of its own. Host-neutral: the
 * cooperative cancel itself is the run's abort signal (the kernel races every dispatch against it) and the
 * steering drain is `beforeTurn` over the `SteeringSource` port, so what remains of the cloud's old
 * `runtime/cloudLoopControl.ts` in the agent is this one string — named for the run, not for a host.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

/** The notice a cancelled run reports when it said nothing — one string so every host's finalize and the tests name it identically. */
export const RUN_CANCELLED_NOTICE = "Run cancelled before any output was produced.";
