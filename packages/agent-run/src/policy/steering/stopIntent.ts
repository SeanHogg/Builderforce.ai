/**
 * stopIntent — does a message typed during a run mean "stop the run"?
 *
 * THE rule lives once, in `@builderforce/run-guards` (`stopIntent.ts`, PRD 35 E10 / WS8e),
 * shared with on-prem's `ABORT_TRIGGERS`. The steering policy re-exports it so its tests
 * and callers import one home — it never carries a second copy (WS2c, PRD 35 §4 row 2c).
 */

export { ABORT_TRIGGERS, isAbortTrigger, stopIntent } from "@builderforce/run-guards";
