/**
 * telemetry — the uniform outcome row (PRD 35 §8.2, WS6).
 *
 * Two pure pieces: {@link buildOutcomeRow} turns the run's terminal state + turn
 * tally into the one row every entry point writes, and {@link foldTrace} folds a
 * `RunEvent` trace into the base counts. Both are plain JSON in / plain row out,
 * so a cloud tick, a Worker invocation and a VS Code host build the identical row.
 */

export { buildOutcomeRow, type OutcomeRowInput } from "./outcomeRow.js";
export { emptyTally, foldEvent, foldTrace, type EventTally } from "./eventTally.js";
