/**
 * agentsParticipant — the agents' place in environment recovery (W12 phase 4). The coordinator (`EnvironmentRecovery`, in the
 * webcontainers browser package) restores the VFS, resources and services first; agents come last (`stage: 'capabilities'`).
 * This participant owns only the agents' run checkpoints: it finds the runs that were interrupted, maps each checkpoint to a
 * resume (`resume.ts`) and hands it to the host to drive again. It never serialises another owner's state.
 */
import type { EventSink, RunEventCorrelation, RunStore } from "@builderforce/agent-run";
import { resumeFromCheckpoint, type RecoveredRun } from "./resume.js";

// Structurally the browser package's `recovery/environmentRecovery.ts` contract: agent-env cannot import the open runtime's
// browser package (it is not a dependency of any Builderforce package), so the shape is restated here and must match it.

/** One participant's report to the recovery coordinator. */
export type RecoveryResult = { id: string; status: "restored" | "fresh" | "skipped" | "failed"; detail?: string };

/** A state owner the recovery coordinator checkpoints and recovers, in stage order. */
export interface RecoveryParticipant {
  id: string;
  stage: "vfs" | "resources" | "services" | "capabilities";
  dependsOn?: string[];
  checkpoint(): Promise<void>;
  recover(): Promise<RecoveryResult>;
}

/** A run that was live when the runtime stopped: its own store (the ONE run store) and event stream. */
export interface InterruptedRun {
  runId: string;
  store: Pick<RunStore, "load">;
  events: EventSink;
  correlation?: RunEventCorrelation;
}

export interface AgentsParticipantDeps {
  /** The runs that had not settled when the runtime stopped. */
  interrupted(): Promise<readonly InterruptedRun[]>;
  /** Drive a run again from its resume (`RunAgentInput.resume`). Resolves once the run is under way, not when it settles. */
  restart(run: InterruptedRun, recovered: RecoveredRun): Promise<void>;
  /** Make every live run's pending checkpoint and tool results durable (the step-batched writes still buffered). */
  checkpoint(): Promise<void>;
  /** Participants the agents wait on (the VFS, databases and services they act against). */
  dependsOn?: string[];
}

export const AGENTS_PARTICIPANT_ID = "agents";

export function createAgentsParticipant(deps: AgentsParticipantDeps): RecoveryParticipant {
  return {
    id: AGENTS_PARTICIPANT_ID,
    stage: "capabilities",
    ...(deps.dependsOn ? { dependsOn: deps.dependsOn } : {}),
    checkpoint: () => deps.checkpoint(),
    async recover() {
      const runs = await deps.interrupted();
      if (!runs.length) return { id: AGENTS_PARTICIPANT_ID, status: "fresh" };
      const settled = await Promise.allSettled(runs.map((run) => recoverRun(run, deps)));
      const failures = settled.flatMap((outcome, i) => outcome.status === "rejected" ? [`${runs[i]!.runId}: ${reasonOf(outcome.reason)}`] : []);
      const resumed = settled.filter((outcome) => outcome.status === "fulfilled" && outcome.value).length;
      if (failures.length) return { id: AGENTS_PARTICIPANT_ID, status: "failed", detail: `${failures.length} of ${runs.length} runs did not resume — ${failures.join("; ")}` };
      if (!resumed) return { id: AGENTS_PARTICIPANT_ID, status: "fresh", detail: `${runs.length} interrupted runs had no checkpoint` };
      return { id: AGENTS_PARTICIPANT_ID, status: "restored", detail: `${resumed} of ${runs.length} runs resumed` };
    },
  };
}

/** One run: its checkpoint to a resume, then the host drives it. `false` ⇒ it never checkpointed. */
async function recoverRun(run: InterruptedRun, deps: AgentsParticipantDeps): Promise<boolean> {
  const recovered = await resumeFromCheckpoint({ store: run.store, events: run.events, ...(run.correlation ? { correlation: run.correlation } : {}) });
  if (!recovered) return false;
  await deps.restart(run, recovered);
  return true;
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
