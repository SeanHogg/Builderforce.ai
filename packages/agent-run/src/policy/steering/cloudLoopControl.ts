/**
 * Cooperative loop control — what remains of `api/src/application/runtime/cloudLoopControl.ts`
 * (WS2c, PRD 35 §4 row 2c) once the one agent owns both halves of it: the steering drain is
 * `beforeTurn` reading the `SteeringSource` port, and cancellation is the run's abort
 * signal, which the kernel races every dispatch against. Only the terminal reason a
 * cooperatively-cancelled cloud run is closed out with stays a shared constant.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

/** The terminal reason a cooperatively-cancelled cloud run is closed out with — one
 *  string so the loop, the finalize and the tests all name it identically. */
export const CLOUD_RUN_CANCELLED_REASON = "Run cancelled before any output was produced.";
