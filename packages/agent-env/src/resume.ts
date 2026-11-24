/**
 * resume — a stored checkpoint back into a run (W12 phase 4). The checkpoint IS the ONE run store's state (`RunStore.load`),
 * the shape `RunAgentInput.resume` takes: there is no second format. A resumed run continues after its last recorded step,
 * and says so once on the run's own event stream (`run.recovered`), with the environment's correlation fields.
 */
import type { EventSink, RunAgentInput, RunEventCorrelation, RunState, RunStore } from "@builderforce/agent-run";

/** What a checkpoint resumes as: the state to hand `RunAgentInput.resume`, and where the run picks up. */
export interface RecoveredRun {
  resume: NonNullable<RunAgentInput["resume"]>;
  /** The last step the checkpoint recorded (the kernel numbers steps from 0). */
  fromStep: number;
  /** The step the run continues at: the checkpoint's `step`, the kernel's next step index. */
  step: number;
}

export interface ResumeDeps {
  store: Pick<RunStore, "load">;
  events: EventSink;
  /** Which environment, runtime and agent the run belongs to; stamped on the `run.recovered` event. */
  correlation?: RunEventCorrelation;
}

/** A stored checkpoint that is not a run state: a resume must fail loudly rather than start the run over. */
export class InvalidCheckpointError extends Error {
  constructor(detail: string) {
    super(`The stored checkpoint is not a run state: ${detail}.`);
    this.name = "InvalidCheckpointError";
  }
}

/**
 * Load the run's checkpoint and map it to a resume. Nothing stored ⇒ `undefined` (the run never checkpointed, and starts fresh).
 * A stored checkpoint emits `run.recovered` once, before the run is driven again.
 */
export async function resumeFromCheckpoint(deps: ResumeDeps): Promise<RecoveredRun | undefined> {
  const stored = await deps.store.load();
  if (stored === undefined) return undefined;
  const resume = checkpointState(stored);
  // `RunState.step` counts the steps taken, so it is the index of the next one; a checkpoint taken before any step has none behind it.
  const recovered: RecoveredRun = { resume, fromStep: Math.max(0, resume.step - 1), step: resume.step };
  await deps.events.emit({ kind: "run.recovered", step: recovered.step, fromStep: recovered.fromStep, ...deps.correlation });
  return recovered;
}

/** The checkpoint as the run's state, checked for the fields every resume reads. */
function checkpointState(stored: unknown): RunState {
  if (!stored || typeof stored !== "object") throw new InvalidCheckpointError("it is not an object");
  const state = stored as Partial<RunState>;
  if (!Array.isArray(state.messages)) throw new InvalidCheckpointError("it has no transcript");
  if (typeof state.step !== "number" || !Number.isInteger(state.step) || state.step < 0) throw new InvalidCheckpointError("it has no step");
  return stored as RunState;
}
