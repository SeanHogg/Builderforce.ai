/**
 * THE run-knowledge record of each on-prem run, by run id — so the agent loop's per-turn
 * brief and the knowledge loop's note and code map read ONE recorder.
 *
 * Two parts of the runtime see a run's tool calls. The native agent loop
 * (`builderforce/agent-loop/agent-loop.ts`) sees each call with the kernel's own
 * arguments as it dispatches it, and restates the record before every turn. The knowledge
 * loop (`knowledge-loop.ts`) sees the run's tool EVENTS and, when the run ends, writes the
 * `.builderforce/memory` note and pushes the code map. Each used to build its own
 * recorder, so the brief and the note could disagree about what the run did.
 *
 * Exactly one side FEEDS the record. A run on the native loop claims it
 * ({@link claimRunKnowledge}) and records from the kernel; the knowledge loop then only
 * reads it. A run on any other engine (one the native loop never sees) is fed from its
 * events by the knowledge loop, as before.
 */
import { RunKnowledgeRecorder } from "@builderforce/agent-tools";

interface Entry {
  recorder: RunKnowledgeRecorder;
  /** True once the native agent loop records this run's calls itself. */
  fedByLoop: boolean;
}

const byRun = new Map<string, Entry>();

function entryFor(runId: string, prompt: string | undefined): Entry {
  let entry = byRun.get(runId);
  if (!entry) {
    entry = { recorder: new RunKnowledgeRecorder(), fedByLoop: false };
    byRun.set(runId, entry);
  }
  // Named for the request it serves, whichever side reached it first.
  if (prompt && !entry.recorder.activity.prompt) entry.recorder.setPrompt(prompt);
  return entry;
}

/** The run's recorder, for an OBSERVER of the run (the knowledge loop). */
export function runKnowledgeFor(runId: string, prompt?: string): RunKnowledgeRecorder {
  return entryFor(runId, prompt).recorder;
}

/** The run's recorder, for the native agent loop, which from now on feeds it. */
export function claimRunKnowledge(runId: string, prompt?: string): RunKnowledgeRecorder {
  const entry = entryFor(runId, prompt);
  entry.fedByLoop = true;
  return entry.recorder;
}

/** Whether the native agent loop feeds this run's record (so events must not, too). */
export function isRunKnowledgeFedByLoop(runId: string): boolean {
  return byRun.get(runId)?.fedByLoop === true;
}

/** Forget the run. Holders keep their reference; only the lookup goes. */
export function releaseRunKnowledge(runId: string): void {
  byRun.delete(runId);
}

export function resetRunKnowledgeForTest(): void {
  byRun.clear();
}
