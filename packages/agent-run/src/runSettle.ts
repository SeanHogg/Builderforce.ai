/**
 * Every path out of a run: save the state, write the outcome row, emit the closing
 * event and return the outcome.
 */

import type { RunMessage, RunOutcome, RunOutcomeRow, RunState } from "./contract.js";
import type { PolicyHooks } from "./policy/index.js";
import { currentView, emit, policyContext, type RunAgentInput, type TurnTally } from "./runContext.js";
import { newApprovalId } from "./runState.js";
import { buildOutcomeRow } from "./telemetry/outcomeRow.js";

/** What a terminal outcome carries beyond the state. */
interface SettleExtra {
  output?: string;
  question?: string;
  approvalId?: string;
  reason?: string;
}

/**
 * Save the state, write the outcome row, emit the closing event and return the
 * outcome. Every path out of the run comes through here, so a resumed tick and a
 * continuous run record the same row.
 */
export async function settle(
  input: RunAgentInput,
  hooks: PolicyHooks,
  state: RunState,
  transcript: RunMessage[],
  kind: RunOutcome["kind"],
  extra: SettleExtra,
  tally: TurnTally,
): Promise<RunOutcome> {
  state.messages = transcript;

  if (kind === "finished") {
    const consolidated = await hooks.memory.consolidate(policyContext(input, state, currentView(transcript, []), state.step, 0));
    if (consolidated !== undefined) {
      try {
        await input.ports.store.commitMemory?.(consolidated);
      } catch {
        // A failed write-back is recorded by its absence, not by failing a finished run.
      }
    }
  }

  try {
    await input.ports.store.save(state);
  } catch {
    // A store that cannot save still returns the state to the caller, who holds it.
  }

  // The uniform §8.2 outcome row: base counts from the turn tally, efficiency
  // fields from the run state. One row per run, every entry point (WS6).
  const row: RunOutcomeRow = buildOutcomeRow({
    entryPoint: input.policy.entryPoint,
    kind,
    steps: state.step,
    toolCalls: tally.toolCalls,
    toolErrors: tally.toolErrors,
    model: tally.model,
    state,
  });
  try {
    await input.ports.events.outcome?.(row);
  } catch {
    // As with the trace: a broken sink records nothing.
  }
  // A yielded tick has not finished: the next tick resumes and the trace is one run.
  // Emitting `run.finished` here would close a run that is still open.
  if (kind !== "yielded") await emit(input.ports.events, { kind: "run.finished", step: state.step, outcome: kind });

  if (kind === "finished") return { kind, output: extra.output ?? "", state };
  if (kind === "paused") return { kind, question: extra.question ?? "", approvalId: extra.approvalId ?? newApprovalId(state), state };
  if (kind === "failed") return { kind, reason: extra.reason ?? "failed", state };
  return { kind, state };
}

