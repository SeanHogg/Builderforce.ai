/**
 * Every path out of a run: save the state, write the outcome row, emit the closing
 * event and return the outcome.
 */

import type { RunMessage, RunOutcome, RunState } from "./contract.js";
import type { PolicyHooks } from "./policy/index.js";
import { currentView, emit, policyContext, type RunAgentInput } from "./runContext.js";
import { newApprovalId } from "./runState.js";
import { buildOutcomeRow } from "./telemetry/outcomeRow.js";

/** What a terminal outcome carries beyond the state. */
interface SettleExtra {
  output?: string;
  question?: string;
  approvalId?: string;
  reason?: string;
  /** A non-transport exception that ended the run, for the surface to re-throw (a platform eviction re-arms; it is not a failure). */
  cause?: unknown;
  /** A budget or the failure breaker ended the run. */
  exhausted?: boolean;
}

/**
 * Save the state, write the outcome row, emit the closing event and return the
 * outcome. Every path out of the run comes through here, so a resumed tick and a
 * continuous run record the same row.
 *
 * The row is written ONCE per run (§8.2), when the run ENDS — `finished` or `failed`.
 * A `yielded` tick and a `paused` run both resume into the same run (the next tick, the
 * person's answer), so a row there would count one run several times, and the ingest
 * keeps the FIRST row per run id: an early row would shadow the real outcome.
 */
export async function settle(
  input: RunAgentInput,
  hooks: PolicyHooks,
  state: RunState,
  transcript: RunMessage[],
  kind: RunOutcome["kind"],
  extra: SettleExtra,
): Promise<RunOutcome> {
  state.messages = transcript;

  // An exception the surface will re-throw (a platform eviction) is not the run's end: the run resumes, so nothing terminal is written.
  const resumable = extra.cause !== undefined;
  if ((kind === "finished" || kind === "failed") && !resumable) {
    // The code map is committed on EVERY terminal outcome (a stopped or failed investigation still mapped
    // what it read); the learned facts are a finished run's alone.
    const pctx = policyContext(input, state, currentView(transcript, []), state.step, 0);
    const consolidated = kind === "finished" ? await hooks.memory.consolidate(pctx) : await hooks.memory.codeMap?.(pctx);
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

  // A yielded tick has not finished: the next tick resumes and the trace is one run. Nor has a run that ended in an
  // exception the surface re-throws (a platform eviction): it resumes. Neither writes a row or closes the trace.
  if (kind === "yielded" || resumable) {
    return kind === "failed" ? { kind, reason: extra.reason ?? "failed", state, cause: extra.cause } : { kind: "yielded", state };
  }

  // The uniform §8.2 outcome row, built from the run state the whole run carried (its tally is in `state.telemetry`).
  if (kind === "finished" || kind === "failed") {
    const row = buildOutcomeRow({ entryPoint: input.policy.entryPoint, runId: input.task.runId, kind, state });
    try {
      await input.ports.events.outcome?.(row);
    } catch {
      // As with the trace: a broken sink records nothing.
    }
  }
  await emit(input.ports.events, { kind: "run.finished", step: state.step, outcome: kind });

  if (kind === "finished") return { kind, output: extra.output ?? "", state };
  if (kind === "paused") return { kind, question: extra.question ?? "", approvalId: extra.approvalId ?? newApprovalId(state), state };
  return { kind, reason: extra.reason ?? "failed", state, ...(extra.cause !== undefined ? { cause: extra.cause } : {}), ...(extra.exhausted ? { exhausted: true } : {}) };
}

