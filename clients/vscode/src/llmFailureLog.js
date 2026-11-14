/**
 * One output-channel line per failed model call.
 *
 * A failed `llm.complete` step reaches the webview as a banner sentence and a transcript
 * row, but the BuilderForce output channel used to say nothing - no model, no destination,
 * no request size. The host owns the runs, so it watches each run's trace and logs every
 * failed completion once: `[llm] <ref> failed: <message> - <describeStreamFailure>`.
 */
import { describeStreamFailure } from "@seanhogg/builderforce-brain-embedded";
/** The line for one failed `llm.complete` step. */
export function llmFailureLine(ev) {
    const args = (ev.args ?? {});
    const model = typeof args.model === "string" ? args.model : "default";
    const message = typeof ev.result === "string" ? ev.result : "unknown error";
    const detail = args.failure ? ` — ${describeStreamFailure(args.failure)}` : "";
    return `[llm] ${model} failed: ${message}${detail}`;
}
/**
 * A logger fed a run's whole trace on every change: it writes each failed completion once
 * (events are matched by identity, so the same step is never logged twice).
 */
export function createLlmFailureLogger(log) {
    const seen = new WeakSet();
    return (trace) => {
        for (const ev of trace) {
            if (ev.label !== "llm.complete" || !ev.isError || seen.has(ev))
                continue;
            seen.add(ev);
            log(llmFailureLine(ev));
        }
    };
}
//# sourceMappingURL=llmFailureLog.js.map