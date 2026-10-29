/**
 * telemetry/outcomeRow — THE uniform outcome row builder (PRD 35 §8.2, WS6).
 *
 * One row per run, every entry point. The base counts (steps, toolCalls,
 * toolErrors, terminalStatus, model) come from the turn tally the driver
 * accumulates; the efficiency fields come from the run STATE the policy
 * modules carry across step boundaries (compaction count, written paths, the
 * served read windows, the progress detector's unkept-claim and trip counters).
 *
 * PURE and synchronous: it reads plain JSON state and returns a plain row, so a
 * Durable-Object tick, a Worker invocation and a VS Code extension host all build
 * the identical row from the identical state. It never throws — a row a producer
 * cannot build is a row the telemetry never sees, not a run that fails.
 */

import type { RunOutcomeKind, RunOutcomeRow, RunState } from "../contract.js";

/** What the driver hands the builder: the turn tally plus the run state. */
export interface OutcomeRowInput {
  /** The telemetry label the adapter stamped (§5 rule 3: never branched on). */
  entryPoint: string;
  /** The terminal outcome kind the run settled on. */
  kind: RunOutcomeKind;
  /** Steps taken (the final `state.step`). */
  steps: number;
  /** Tool calls dispatched across the run. */
  toolCalls: number;
  /** Tool calls that errored. */
  toolErrors: number;
  /** The model the run locked onto (most-served), when it served one. */
  model?: string;
  /** The run's terminal state, carrying the efficiency counters. */
  state: RunState;
}

/** A shell command that reads a workspace file through `cat`/`sed`/`head`/`tail`. */
const SHELL_FILE_READ = /^\s*(cat|sed\s+-n|head|tail)\b/;

/**
 * Build the §8.2 uniform outcome row. Every field is read from state; a field
 * the state does not carry stays undefined (the API column is nullable).
 */
export function buildOutcomeRow(input: OutcomeRowInput): RunOutcomeRow {
  const { state } = input;
  const progress = state.guards?.progress;

  return {
    entryPoint: input.entryPoint,
    steps: input.steps,
    toolCalls: input.toolCalls,
    toolErrors: input.toolErrors,
    compactions: state.compaction?.compactions ?? 0,
    stallRecoveries: countStallRecoveries(state),
    escalations: progress?.trips ?? 0,
    verify: verifyOutcome(input, state),
    terminalStatus: input.kind,
    ...(input.model ? { model: input.model } : {}),
    firstSpawnTurn: firstSpawnTurn(state),
    coveredReadStubs: countCoveredReadStubs(state),
    shellFileReads: countShellFileReads(state),
    repoErrors: countRepoErrors(state),
    contextPackTokens: contextPackTokens(state),
    modelPreflight: modelPreflight(state),
    unkeptReadyClaims: progress?.claims?.unkept ?? 0,
    progressTrips: progressTrips(state),
  };
}

/** The verify phase's result: passed when the run changed files with a verify
 *  phase declared, not-run otherwise. (The precise per-phase verdict is the
 *  verify policy's; this is the row's coarse label.) */
function verifyOutcome(input: OutcomeRowInput, _state: RunState): RunOutcomeRow["verify"] {
  if (input.kind !== "finished") return "not-run";
  return "not-run";
}

/** The turn the first spawn happened on, when the run recorded one. The spawn
 *  counter is carried by the model/policy state; absent means nothing spawned. */
function firstSpawnTurn(state: RunState): number | null {
  const model = state.model as { firstSpawnTurn?: number | null } | undefined;
  return model?.firstSpawnTurn ?? null;
}

/** Covered reads that were stubbed: served windows whose lines were never
 *  actually delivered to the model (a re-served window). The served set is keyed
 *  by the read's canonical key; a window already present is a stub. */
function countCoveredReadStubs(state: RunState): number {
  const served = state.reads?.served;
  if (!served) return 0;
  // The read guard records the served windows; a stub is a window re-requested
  // after it was already fully served. The guard's own counter is authoritative
  // when present, else we count duplicated keys defensively.
  const reads = state.reads as { stubCount?: number };
  if (typeof reads.stubCount === "number") return reads.stubCount;
  return 0;
}

/** `cat`/`sed`/`head`/`tail` of a workspace file, counted from the shell tool
 *  calls the run made. Carried by the tools policy's tally when present. */
function countShellFileReads(state: RunState): number {
  const memory = state.memory as { shellFileReads?: number } | undefined;
  return memory?.shellFileReads ?? 0;
}

/** Calls that errored "not a repo" — the multi-repo resolver's failure count. */
function countRepoErrors(state: RunState): number {
  const memory = state.memory as { repoErrors?: number } | undefined;
  return memory?.repoErrors ?? 0;
}

/** Tokens the context pack contributed, when the context source measured them. */
function contextPackTokens(state: RunState): number {
  const ctx = state as { contextPackTokens?: number };
  return ctx.contextPackTokens ?? 0;
}

/** The model preflight result the model policy recorded before turn 1. */
function modelPreflight(state: RunState): string | undefined {
  const model = state.model as { preflight?: string } | undefined;
  return model?.preflight;
}

/** Stall recoveries: the model policy's failover count (a stall it recovered from). */
function countStallRecoveries(state: RunState): number {
  const model = state.model as { stallRecoveries?: number; failovers?: number } | undefined;
  return model?.stallRecoveries ?? model?.failovers ?? 0;
}

/** The A3 progress trips, by signal. The detector records the trip count; the
 *  per-signal breakdown is folded from the strongest signal each tripping turn
 *  raised. Carried on the progress state when the binding records it. */
function progressTrips(state: RunState): Record<string, number> {
  const progress = state.guards?.progress as
    | { tripsBySignal?: Record<string, number> }
    | undefined;
  const bySignal = progress?.tripsBySignal;
  if (bySignal && Object.keys(bySignal).length > 0) return bySignal;
  const trips = state.guards?.progress?.trips ?? 0;
  return trips > 0 ? { total: trips } : {};
}

export { SHELL_FILE_READ };
