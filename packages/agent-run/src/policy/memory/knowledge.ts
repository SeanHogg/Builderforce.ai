/**
 * policy/memory/knowledge — the run's record, rebuilt across a step boundary.
 *
 * `RunState.memory` is `@builderforce/agent-tools`' `RunKnowledgeState`
 * (`packages/agent-tools/src/run-knowledge.ts:96`) — REUSED, never redefined. A host
 * that runs one step per process (a cloud tick) must carry that state or every step
 * starts with an empty memory: the brief is never worth giving and the run-end map
 * covers one step. {@link RunKnowledgeRecorder.restore} is the one rebuild seam, so a
 * resumed run continues the SAME record a continuous run holds.
 *
 * The recorder lives on a per-process `WeakMap` keyed by the `RunState` object — a
 * plain-data state crosses a step boundary as JSON, and on resume the composition hands
 * back a fresh object, so the recorder is rebuilt from `state.memory` exactly once.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import { RunKnowledgeRecorder, type RunKnowledgeLog, type RunKnowledgeState } from "@builderforce/agent-tools";

/** The rebuilt recorder for a state's memory slice. */
export function knowledgeRecorderFor(memory: RunKnowledgeState | undefined): RunKnowledgeLog {
  return RunKnowledgeRecorder.restore(memory ?? null);
}

/** The state {@link knowledgeRecorderFor}'s recorder rebuilds from, after recording. */
export function knowledgeState(recorder: RunKnowledgeLog): RunKnowledgeState {
  const log = recorder as { snapshot?: () => RunKnowledgeState };
  return typeof log.snapshot === "function" ? log.snapshot() : (recorder as unknown as RunKnowledgeState);
}

/**
 * The one recorder per run, rebuilt lazily from the state it is keyed on. A `RunState`
 * object is the identity of one run for one invocation; when a resume hands back a new
 * object the old entry is unreachable and collected.
 */
const recorders = new WeakMap<object, RunKnowledgeLog>();

/**
 * The recorder for this run's state, restoring it from `state.memory` the first time
 * this state object is seen. Mutations land on the recorder; the caller writes the
 * snapshot back into `state.memory` when it persists.
 */
export function recorderForState(state: { memory?: RunKnowledgeState }): RunKnowledgeLog {
  const key = state as object;
  let recorder = recorders.get(key);
  if (!recorder) {
    recorder = knowledgeRecorderFor(state.memory);
    recorders.set(key, recorder);
  }
  return recorder;
}
