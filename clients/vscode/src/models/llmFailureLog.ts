/**
 * One output-channel line per failed model call.
 *
 * A failed `llm.complete` step reaches the webview as a banner sentence and a transcript
 * row, but the BuilderForce output channel used to say nothing - no model, no destination,
 * no request size. The host owns the runs, so it watches each run's trace and logs every
 * failed completion once: `[llm] <ref> failed: <message> - <describeStreamFailure>`.
 */

import { describeStreamFailure, type BrainTraceEvent, type StreamFailureDetail } from "@seanhogg/builderforce-brain-embedded";

/** The line for one failed `llm.complete` step. */
export function llmFailureLine(ev: BrainTraceEvent): string {
  const args = (ev.args ?? {}) as { model?: unknown; failure?: StreamFailureDetail };
  const model = typeof args.model === "string" ? args.model : "default";
  const message = typeof ev.result === "string" ? ev.result : "unknown error";
  const detail = args.failure ? ` — ${describeStreamFailure(args.failure)}` : "";
  return `[llm] ${model} failed: ${message}${detail}`;
}

/**
 * A logger fed a run's whole trace on every change: it writes each failed completion once
 * (events are matched by identity, so the same step is never logged twice).
 */
export function createLlmFailureLogger(log: (line: string) => void): (trace: readonly BrainTraceEvent[]) => void {
  const seen = new WeakSet<BrainTraceEvent>();
  return (trace) => {
    for (const ev of trace) {
      if (ev.label !== "llm.complete" || !ev.isError || seen.has(ev)) continue;
      seen.add(ev);
      log(llmFailureLine(ev));
    }
  };
}
