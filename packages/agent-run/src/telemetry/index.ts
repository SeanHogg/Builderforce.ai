/**
 * telemetry — the uniform outcome row (PRD 35 §8.2, WS6).
 *
 * Three pure pieces: the {@link RunTally} the driver feeds as the run goes (carried on
 * `RunState.telemetry`, so it sums across ticks), {@link buildOutcomeRow} which turns
 * the run's terminal state into the one row every entry point writes, and
 * {@link foldTrace} which folds a `RunEvent` trace into the base counts. All plain JSON
 * in / plain row out, so a cloud tick, a Worker invocation and a VS Code host build the
 * identical row.
 */

export { buildOutcomeRow, type OutcomeRowInput } from "./outcomeRow.js";
export { freshTally, resumeTally, tallyCall, tallyTurn, tallyVerify, type RunTally } from "./runTally.js";
export { emptyTally, foldEvent, foldTrace, type EventTally } from "./eventTally.js";
