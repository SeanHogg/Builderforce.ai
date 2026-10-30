/**
 * Every path out of a run: save the state, write the outcome row, emit the closing
 * event and return the outcome.
 */

import type { RunMessage, RunOutcome, RunState } from "./contract.js";
import type { PolicyHooks } from "./policy/index.js";
import { currentView, emit, policyContext, type RunAgentInput } from "./runContext.js";
import { newApprovalId } from "./runState.js";
import { isResumable } from "./runTurn.js";
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
  let cause = extra.cause;
  // The run-end write-back happens on every TERMINAL outcome - finished, failed, cancelled
  // - because what a run read and changed is worth keeping whatever became of it. What a
  // run LEARNED is a judgement of a completed one, so that half is finished-only. A run that
  // parked or yielded is not over.
  if ((kind === "finished" || kind === "failed") && cause === undefined) {
    try {
      const consolidated = await hooks.memory.consolidate(
        policyContext(input, state, currentView(transcript, []), state.step, 0),
        { learn: kind === "finished" },
      );
      if (consolidated !== undefined) await input.ports.store.commitMemory?.(consolidated);
    } catch (err) {
      // A failed consolidation or write-back is recorded by its absence: it must neither fail the run nor cost it the
      // state, the outcome row and the closing event below - UNLESS the surface says the exception is a resumable
      // interruption: then the run resumes, exactly as for any other port.
      if (isResumable(input, err)) cause = err;
    }
  }
  const resumable = cause !== undefined;

  try {
    await input.ports.store.save(state);
  } catch {
    // A store that cannot save still returns the state to the caller, who holds it.
  }

  // A yielded tick has not finished: the next tick resumes and the trace is one run. Nor has a run that ended in an
  // exception the surface re-throws (a platform eviction): it resumes. Neither writes a row or closes the trace.
  if (kind === "yielded" || resumable) {
    return kind === "failed" || cause !== undefined ? { kind: "failed", reason: extra.reason ?? (cause instanceof Error ? cause.message : "failed"), state, cause } : { kind: "yielded", state };
  }

  // The uniform §8.2 outcome row, built from the run state the whole run carried (its tally is in `state.telemetry`).
  if (kind === "finished" || kind === "failed") {
    const row = buildOutcomeRow({ entryPoint: input.policy.entryPoint, runId: input.task.runId, parentRunId: input.task.dispatch.parentRunId, kind, ...(extra.reason !== undefined ? { reason: extra.reason } : {}), state });
    try {
      await input.ports.events.outcome?.(row);
    } catch {
      // As with the trace: a broken sink records nothing.
    }
    // Only a TERMINAL settle closes the trace. A paused run resumes into the same run (the person's answer), so a
    // `run.finished(paused)` here would be followed by a second `run.finished` when it ends.
    await emit(input.ports.events, { kind: "run.finished", step: state.step, outcome: kind });
  }

  if (kind === "finished") return { kind, output: extra.output ?? "", state };
  if (kind === "paused") return { kind, question: extra.question ?? "", approvalId: extra.approvalId ?? newApprovalId(state), state };
  return { kind, reason: extra.reason ?? "failed", state, ...(extra.cause !== undefined ? { cause: extra.cause } : {}), ...(extra.exhausted ? { exhausted: true } : {}) };
}

