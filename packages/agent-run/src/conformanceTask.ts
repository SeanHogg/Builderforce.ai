/**
 * conformanceTask — the ONE scripted task every entry point is held to (PRD 35 §3.3 "Conformance suite").
 *
 * The same prompt, the same fake-model script and the same expected trace and answer are imported by the
 * conformance case of every adapter — each lives beside the adapter it drives (a package can only load its own
 * dependencies), so the task cannot be restated per package: a restated script would let one adapter drift from
 * another without any test noticing. A surface supplies PORTS; this is what the run must then do with them.
 *
 * `conformanceTrace` folds a run's {@link RunEvent}s to the facts that are the same on every surface (the order
 * of events, the model that answered, the tool that ran and whether it did) and leaves out what a surface
 * legitimately measures differently (steps, token counts, the size of its tool catalog).
 *
 * Plain data and one pure function: no `node:*`, no DOM, no test runner.
 */

import type { EventSink, ModelCompletion } from "./contract.js";
import type { RunEvent } from "./runEvents.js";

/** What the person asks. */
export const CONFORMANCE_PROMPT = "Say hello, then finish.";

/** What the run must end with. */
export const CONFORMANCE_ANSWER = "Hello! Done.";

/** The model id the fake model reports. */
export const CONFORMANCE_MODEL = "fake-model";

/** The fake model's answers, in order: a `finish` call, then the closing prose. */
export const CONFORMANCE_SCRIPT: readonly ModelCompletion[] = [
  { content: "", toolCalls: [{ id: "call-1", name: "finish", arguments: '{"summary":"Hello! Done."}' }], model: CONFORMANCE_MODEL },
  { content: CONFORMANCE_ANSWER, model: CONFORMANCE_MODEL },
];

/**
 * The trace every entry point emits for the scripted task, in order. A `finish` call ends the run at once, so the second
 * scripted answer is never asked for; it is there so a run that wrongly asks again fails on content, not on a thrown script.
 * Pinned and proved by `test/conformance/crossAdapter.test.ts`.
 */
export const CONFORMANCE_TRACE: readonly string[] = [
  "run.started",
  "model.preflight",
  "turn.started",
  "context.tools",
  "model.completed:fake-model",
  "tool.dispatched:finish:ok",
  "turn.finished",
  "run.finished:finished",
];

/**
 * The trace of a surface whose tool catalog is CLOSED to its own tools (the Creation Canvas, channels and cron): the shared
 * `finish` is not among them, so the scripted call is refused and the run ends on the model's next prose turn. It is the
 * same run with that one difference, pinned here so the difference is named once and not re-derived per adapter.
 */
export const CONFORMANCE_TRACE_CLOSED_CATALOG: readonly string[] = [
  "run.started",
  "model.preflight",
  "turn.started",
  "context.tools",
  "model.completed:fake-model",
  "tool.dispatched:finish:error",
  "turn.finished",
  "turn.started",
  "model.completed:fake-model",
  "run.finished:finished",
];

/** One event as the fact every surface agrees on. */
export function conformanceFact(event: RunEvent): string {
  switch (event.kind) {
    case "model.completed":
      return `model.completed:${event.model ?? ""}`;
    case "tool.dispatched":
      return `tool.dispatched:${event.tool}:${event.ok ? "ok" : "error"}`;
    case "run.finished":
      return `run.finished:${event.outcome}`;
    default:
      return event.kind;
  }
}

/** A run's trace folded to the facts that must be identical on every entry point. */
export function conformanceTrace(events: readonly RunEvent[]): string[] {
  return events.map(conformanceFact);
}

/**
 * An event sink that also copies every event into `into`, so a test can read the trace of a run an ADAPTER built
 * the ports for. It forwards to `sink` unchanged — it observes the adapter's own sink, it does not replace it.
 */
export function teeEvents(sink: EventSink | undefined, into: RunEvent[]): EventSink {
  return {
    emit: (event, meta) => {
      into.push(event);
      return sink?.emit(event, meta);
    },
    ...(sink?.outcome ? { outcome: (row) => sink.outcome?.(row) } : {}),
  };
}
