/**
 * telemetry/outcomeRow — THE uniform outcome row builder (PRD 35 §8.2, WS6).
 *
 * One row per run, every entry point, built when the run ends. Every field has ONE
 * writer in the run, and the builder only reads it back out of the run state:
 *
 *   steps                      `state.step` (the driver)
 *   tool_calls / tool_errors   `state.telemetry` — the driver, from the trace's own verdict
 *   tokens / cache / cost      `state.telemetry` — every model turn's usage, summed; the cost only
 *                              when EVERY turn was priced (see `costTally.ts`)
 *   model                      `state.telemetry.model` — the model the last turn was served by
 *   verify                     `state.telemetry.verify` — the run-end verify's verdict
 *   first_spawn_turn           `state.telemetry` — the step the first spawn was dispatched on
 *   shell_file_reads           `state.telemetry` — `run_command` prints of one workspace file
 *   repo_errors                `state.telemetry` — calls that answered "not a git repository"
 *   compactions                `state.compaction` (policy/compaction)
 *   stall_recoveries           `state.stall.recoveriesTotal` (policy/stall)
 *   escalations                `state.guards.escalations` (policy/guards: A3 + D1 moves up a tier)
 *   covered_read_stubs         `state.reads.stubCount` (policy/tools read coverage)
 *   context_pack_tokens        `state.context` — the pack's turn-context block, estimated
 *   model_preflight            `state.preflight` (policy/model)
 *   unkept_ready_claims        `state.guards.progress.unkeptTurns` (A3's detector)
 *   progress_trips             `state.guards.progress.tripsBySignal` (A3's detector)
 *
 * PURE and synchronous: plain JSON state in, a plain row out, so a Durable-Object tick,
 * a Worker invocation and a VS Code extension host build the identical row.
 */

import type { RunOutcomeKind, RunOutcomeRow, RunState } from "../contract.js";
import { defaultEstimateTokens } from "../policy/compaction/pack.js";
import { turnContextBlock } from "../turnContext.js";
import { reportedRunCost } from "./costTally.js";
import { resumeTally } from "./runTally.js";

/** What settle hands the builder: the labels the adapter stamped plus the run state. */
export interface OutcomeRowInput {
  /** The telemetry label the adapter stamped (§5 rule 3: never branched on). */
  entryPoint: string;
  /** The adapter's id for the run, when it named one. */
  runId?: string;
  /** The terminal outcome kind the run settled on. */
  kind: RunOutcomeKind;
  /** The run's terminal state. */
  state: RunState;
}

/** Build the §8.2 uniform outcome row from the run's terminal state. */
export function buildOutcomeRow(input: OutcomeRowInput): RunOutcomeRow {
  const { state } = input;
  const tally = resumeTally(state.telemetry);
  const progress = state.guards?.progress;
  const preflight = state.preflight;
  // Known only when every turn was priced (a partly unpriced run has an unknown cost, never a partial sum).
  const runCost = reportedRunCost({ sum: tally.costMc, unpriced: tally.costUnpriced });

  return {
    entryPoint: input.entryPoint,
    ...(input.runId ? { runId: input.runId } : {}),
    steps: state.step,
    toolCalls: tally.toolCalls,
    toolErrors: tally.toolErrors,
    compactions: state.compaction?.compactions ?? 0,
    stallRecoveries: state.stall?.recoveriesTotal ?? 0,
    escalations: state.guards?.escalations ?? 0,
    verify: tally.verify ?? "not-run",
    terminalStatus: input.kind,
    ...(tally.model ? { model: tally.model } : {}),
    tokens: tally.tokens,
    cacheReadTokens: tally.cacheReadTokens,
    ...(runCost !== undefined ? { cost: runCost } : {}),
    firstSpawnTurn: tally.firstSpawnTurn ?? null,
    coveredReadStubs: state.reads?.stubCount ?? 0,
    shellFileReads: tally.shellFileReads,
    repoErrors: tally.repoErrors,
    contextPackTokens: contextPackTokens(state),
    ...(preflight ? { modelPreflight: preflight } : {}),
    unkeptReadyClaims: progress?.unkeptTurns ?? 0,
    progressTrips: tripsBySignal(progress?.tripsBySignal),
  };
}

/** The A3 trips by signal, as a plain `{ signal: count }` map (empty when none tripped). */
function tripsBySignal(bySignal: Partial<Record<string, number>> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [signal, n] of Object.entries(bySignal ?? {})) if (n) out[signal] = n;
  return out;
}

/** The tokens the context pack adds to every request: its turn-context block, estimated
 *  the way compaction estimates (0 when the run had no pack or it rendered nothing). */
function contextPackTokens(state: RunState): number {
  if (!state.context) return 0;
  const block = turnContextBlock(state.context, null);
  return block ? defaultEstimateTokens(block) : 0;
}
